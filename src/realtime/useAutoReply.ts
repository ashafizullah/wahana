import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { useChatPrefs } from "@/store/chatPrefs";
import { activeRules, lastReplyAt, logReply, repliesSince, ruleMatches, type AutoReplyRule } from "@/store/autoReply";
import { expandTemplate } from "@/store/quickReplies";
import { aiAutoReply } from "@/lib/autoReplyAi";
import { qk } from "@/api/queries";
import { displayId, isGroup } from "@/lib/utils";
import type { WAMessage } from "@/api/types";
import type { IncomingMessage } from "@/realtime/useWahaSocket";

/** Ignore messages older than this (socket replays / reconnect bursts). */
const MAX_AGE_S = 120;
/** Small human-like pause before answering. */
const DELAY_MS = [1500, 4000] as const;
/** Hard ceiling regardless of the rule's cooldown, so two auto-responders can't ping-pong forever. */
const MAX_REPLIES = 8;
const MAX_REPLIES_WINDOW_S = 10 * 60;
/** Stay quiet in chats the user answered themselves recently — they're handling it. */
const MANUAL_QUIET_S = 15 * 60;

/**
 * Answers incoming messages according to the auto-reply rules of the active
 * profile: first enabled rule whose scope, time window and pattern match wins,
 * subject to a per-chat cooldown. Runs while the app is alive (tray is fine).
 */
export function useAutoReply() {
  const client = useSettings((s) => s.client);
  const qc = useQueryClient();
  const inflight = useRef(new Set<string>()); // chat ids currently being answered

  useEffect(() => {
    if (!client) return;
    const onIncoming = (ev: Event) => {
      const { session, chatId, message } = (ev as CustomEvent<IncomingMessage>).detail;
      void handle(session, chatId, message);
    };
    const handle = async (session: string, chatId: string, m: WAMessage) => {
      const st = useSettings.getState();
      if (st.autoReplyPaused || !st.client) return;
      if (Date.now() / 1000 - m.timestamp > MAX_AGE_S) return;
      const key = `${session}:${chatId}`;
      if (inflight.current.has(key)) return; // one at a time per chat: bursts get one answer
      inflight.current.add(key);
      let rule: AutoReplyRule | undefined;
      const body = (m.body ?? "").trim();
      const chatName = chatNameFor(session, chatId, m);
      try {
        const now = Date.now() / 1000;
        const rules = await activeRules(st.activeProfile, session);
        rule = rules.find((r) => ruleMatches(r, chatId, body));
        if (!rule) return;
        if (rule.cooldown_min > 0) {
          const last = await lastReplyAt(rule.id, chatId);
          if (last && now - last < rule.cooldown_min * 60) return;
        }
        if ((await repliesSince(session, chatId, now - MAX_REPLIES_WINDOW_S)) >= MAX_REPLIES) return;
        // Recent context: the cache when the chat is open, else a light fetch (the manual-quiet
        // guard and the AI context both need it; chats never opened here have no cache).
        const recent = await recentMessages(session, chatId, Math.max(20, rule.ai_context));
        if (userRepliedRecently(recent, m)) return;

        const reply = rule.reply_kind === "ai" ? await aiReply(rule, session, chatId, chatName, m, recent) : templateReply(rule, chatId, chatName);
        if (!reply) throw new Error("Empty reply");
        await new Promise((r) => setTimeout(r, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])));
        const c = useSettings.getState().client;
        if (!c || useSettings.getState().autoReplyPaused) return;
        if (rule.mark_seen) await c.sendSeen(session, chatId, [m.id], m.participant || undefined).catch(() => {});
        await c.sendText(session, chatId, reply, rule.quote ? m.id : undefined);
        await logReply({ rule_id: rule.id, session, chat_id: chatId, chat_name: chatName, incoming: body || null, reply, status: "sent", error: null });
      } catch (e) {
        if (rule) await logReply({ rule_id: rule.id, session, chat_id: chatId, chat_name: chatName, incoming: body || null, reply: null, status: "error", error: e instanceof Error ? e.message : String(e) });
        else console.warn("auto-reply failed", e);
      } finally {
        inflight.current.delete(key);
        if (rule) qc.invalidateQueries({ queryKey: ["auto-reply"] });
      }
    };

    const recentMessages = async (session: string, chatId: string, limit: number): Promise<WAMessage[]> => {
      const cached = qc.getQueryData<WAMessage[]>(qk.messages(session, chatId));
      if (cached) return cached;
      const c = useSettings.getState().client;
      if (!c) return [];
      return c.messages(session, chatId, { limit, downloadMedia: false }).catch(() => []);
    };

    /** The user's own last message in this chat is newer than MANUAL_QUIET_S. */
    const userRepliedRecently = (recent: WAMessage[], m: WAMessage) => {
      const mine = recent.filter((x) => x.fromMe && x.id !== m.id).reduce((t, x) => Math.max(t, x.timestamp), 0);
      return mine > 0 && m.timestamp - mine < MANUAL_QUIET_S;
    };

    const chatNameFor = (session: string, chatId: string, m: WAMessage) => {
      const chats = qc.getQueryData<{ id: string; name?: string | null }[]>(qk.chats(session));
      const known = chats?.find((c) => c.id === chatId)?.name;
      const push = (m._data as { Info?: { PushName?: string } } | undefined)?.Info?.PushName;
      return known || (!isGroup(chatId) && push) || displayId(chatId);
    };

    const templateReply = (rule: AutoReplyRule, chatId: string, chatName: string) =>
      expandTemplate(rule.text ?? "", { name: chatName, phone: chatId.endsWith("@c.us") ? `+${chatId.split("@")[0]}` : "" }).trim();

    const aiReply = async (rule: AutoReplyRule, session: string, chatId: string, chatName: string, m: WAMessage, recent: WAMessage[]) => {
      // Always include the trigger message.
      const messages = [...recent.filter((x) => x.id !== m.id), m].sort((a, b) => a.timestamp - b.timestamp).slice(-rule.ai_context);
      const language = useChatPrefs.getState().autoTranslate[`${session}:${chatId}`]?.out;
      return aiAutoReply({ instructions: rule.ai_instructions, session, chatName, isGroup: isGroup(chatId), messages, language });
    };

    window.addEventListener("wahana:incoming", onIncoming);
    return () => window.removeEventListener("wahana:incoming", onIncoming);
  }, [client, qc]);
}

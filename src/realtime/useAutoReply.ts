import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { useChatPrefs } from "@/store/chatPrefs";
import { activeRules, lastReplyAt, logReply, ruleMatches, type AutoReplyRule } from "@/store/autoReply";
import { expandTemplate } from "@/store/quickReplies";
import { aiConfigured, complete } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import { qk } from "@/api/queries";
import { displayId, isGroup } from "@/lib/utils";
import type { WAMessage } from "@/api/types";
import type { IncomingMessage } from "@/realtime/useWahaSocket";

/** Ignore messages older than this (socket replays / reconnect bursts). */
const MAX_AGE_S = 120;
/** Small human-like pause before answering. */
const DELAY_MS = [1500, 4000] as const;

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
      if (inflight.current.has(chatId)) return;
      const body = (m.body ?? "").trim();
      const rules = await activeRules(st.activeProfile, session);
      if (rules.length === 0) return;
      const rule = rules.find((r) => ruleMatches(r, chatId, body));
      if (!rule) return;
      if (rule.cooldown_min > 0) {
        const last = await lastReplyAt(rule.id, chatId);
        if (last && Date.now() / 1000 - last < rule.cooldown_min * 60) return;
      }

      inflight.current.add(chatId);
      const chatName = chatNameFor(session, chatId, m);
      try {
        const reply = rule.reply_kind === "ai" ? await aiReply(rule, session, chatId, chatName, m) : templateReply(rule, chatId, chatName);
        if (!reply) throw new Error("Empty reply");
        await new Promise((r) => setTimeout(r, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])));
        const c = useSettings.getState().client;
        if (!c) return;
        if (rule.mark_seen) await c.sendSeen(session, chatId, [m.id], m.participant || undefined).catch(() => {});
        await c.sendText(session, chatId, reply, rule.quote ? m.id : undefined);
        await logReply({ rule_id: rule.id, session, chat_id: chatId, chat_name: chatName, incoming: body || null, reply, status: "sent", error: null });
      } catch (e) {
        await logReply({ rule_id: rule.id, session, chat_id: chatId, chat_name: chatName, incoming: body || null, reply: null, status: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        inflight.current.delete(chatId);
        qc.invalidateQueries({ queryKey: ["auto-reply"] });
      }
    };

    const chatNameFor = (session: string, chatId: string, m: WAMessage) => {
      const chats = qc.getQueryData<{ id: string; name?: string | null }[]>(qk.chats(session));
      const known = chats?.find((c) => c.id === chatId)?.name;
      const push = (m._data as { Info?: { PushName?: string } } | undefined)?.Info?.PushName;
      return known || (!isGroup(chatId) && push) || displayId(chatId);
    };

    const templateReply = (rule: AutoReplyRule, chatId: string, chatName: string) =>
      expandTemplate(rule.text ?? "", { name: chatName, phone: chatId.endsWith("@c.us") ? `+${chatId.split("@")[0]}` : "" }).trim();

    const aiReply = async (rule: AutoReplyRule, session: string, chatId: string, chatName: string, m: WAMessage) => {
      if (!aiConfigured()) throw new Error("AI is not configured (Settings → AI).");
      const c = useSettings.getState().client!;
      // Recent context: what the cache has, else a quick fetch; always include the trigger message.
      let recent = qc.getQueryData<WAMessage[]>(qk.messages(session, chatId));
      if (!recent) recent = await c.messages(session, chatId, { limit: rule.ai_context, downloadMedia: false }).catch(() => []);
      const ctx = [...(recent ?? []).filter((x) => x.id !== m.id), m].sort((a, b) => a.timestamp - b.timestamp).slice(-rule.ai_context);
      const lang = useChatPrefs.getState().autoTranslate[`${session}:${chatId}`]?.out;
      const system = [
        "You are answering WhatsApp messages on behalf of the user while they are away. Write the reply the user would send, in their voice.",
        rule.ai_instructions?.trim() ? `Instructions and knowledge for this auto-reply:\n${rule.ai_instructions.trim()}` : "",
        `Rules: reply in ${lang ? `the language "${lang}"` : "the same language as the last message"}; keep it short (1–3 sentences) unless the instructions require more; never invent prices, dates or commitments not covered by the instructions — say the user will follow up instead; do not mention that you are an AI unless asked; output only the message text, no quotes or preamble.`,
      ].filter(Boolean).join("\n\n");
      const user = `Chat with ${chatName}${isGroup(chatId) ? " (group)" : ""}. Recent messages, oldest first:\n\n${transcript(ctx, () => undefined)}\n\nReply to the last message.`;
      return (await complete(system, user, { maxTokens: 500, fast: true })).trim();
    };

    window.addEventListener("wahana:incoming", onIncoming);
    return () => window.removeEventListener("wahana:incoming", onIncoming);
  }, [client, qc]);
}

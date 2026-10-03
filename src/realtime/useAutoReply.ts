import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { clientForProfile, sendTypingFor, useSettings } from "@/store/settings";
import { useChatPrefs } from "@/store/chatPrefs";
import { activeRules, lastReplyAt, logReply, repliesSince, repliesToday, ruleMatches, type AutoReplyRule } from "@/store/autoReply";
import { expandTemplate } from "@/store/quickReplies";
import { aiAutoReply } from "@/lib/autoReplyAi";
import { accountParts } from "@/lib/account";
import { markSeenOn, sendTextOn, setTypingOn } from "@/lib/send";
import { nativeWa } from "@/lib/nativeWa";
import { qk } from "@/api/queries";
import { displayId, isGroup, errMsg, convKey } from "@/lib/utils";
import type { WAMessage } from "@/api/types";
import type { IncomingMessage } from "@/realtime/useWahaSocket";

/** Ignore messages older than this (socket replays / reconnect bursts). */
const MAX_AGE_S = 120;
/** Small human-like pause before answering. */
const DELAY_MS = [1500, 4000] as const;
/** "Typing…" lasts roughly as long as a person would take to type the reply, within these bounds. */
const TYPING_MS_PER_CHAR = 40;
const TYPING_MS = [2000, 8000] as const;
/** WhatsApp drops a typing indicator after ~25s: refresh it while the AI is still writing. */
const TYPING_REFRESH_MS = 10_000;
/** Hard ceiling regardless of the rule's cooldown, so two auto-responders can't ping-pong forever. */
const MAX_REPLIES = 8;
const MAX_REPLIES_WINDOW_S = 10 * 60;
/** Stay quiet in chats the user answered themselves recently — they're handling it. */
const MANUAL_QUIET_S = 15 * 60;

/**
 * Answers incoming messages according to the rules of the account the message arrived on
 * (WAHA or native): first enabled rule whose scope, time window and pattern match wins,
 * subject to a per-chat cooldown. Runs while the app is alive (tray is fine).
 */
export function useAutoReply() {
  const qc = useQueryClient();
  const inflight = useRef(new Set<string>()); // "account:chat" currently being answered
  const handled = useRef(new Set<string>()); // "account:messageId" already considered
  const dailyLimitWarned = useRef(false);

  // Always listening: rules of a WAHA server that is not the active one still get messages
  // (see useProfileSockets) even when the active profile has no sessions.
  useEffect(() => {
    const onIncoming = (ev: Event) => {
      const { account, chatId, message } = (ev as CustomEvent<IncomingMessage>).detail;
      void handle(account, chatId, message);
    };

    const recentMessages = async (account: string, chatId: string, limit: number): Promise<WAMessage[]> => {
      const p = accountParts(account);
      if (p?.kind === "native" && p.id) {
        const list = await nativeWa.messages(p.id, chatId, limit).catch(() => []);
        return list.map((m) => ({
          id: m.id,
          timestamp: Math.floor(m.timestamp / 1000),
          fromMe: m.fromMe,
          from: m.chatId,
          body: m.body,
          hasMedia: !!m.media,
        })) as unknown as WAMessage[];
      }
      if (p?.kind !== "waha" || !p.session) return [];
      // The query cache is keyed by session name only, so it belongs to the active server.
      const isActive = !p.profile || p.profile === useSettings.getState().activeProfile;
      const cached = isActive ? qc.getQueryData<WAMessage[]>(qk.messages(p.session, chatId)) : undefined;
      if (cached) return cached;
      const c = await clientForProfile(p.profile).catch(() => null);
      if (!c) return [];
      return c.messages(p.session, chatId, { limit, downloadMedia: false }).catch(() => []);
    };

    /** The user's own last message in this chat is newer than MANUAL_QUIET_S. */
    const userRepliedRecently = (recent: WAMessage[], m: WAMessage) => {
      const mine = recent.filter((x) => x.fromMe && x.id !== m.id).reduce((t, x) => Math.max(t, x.timestamp), 0);
      return mine > 0 && m.timestamp - mine < MANUAL_QUIET_S;
    };

    const chatNameFor = (m: WAMessage, chatId: string) => {
      const push = (m._data as { Info?: { PushName?: string } } | undefined)?.Info?.PushName;
      return (!isGroup(chatId) && push) || displayId(chatId);
    };

    const templateReply = (rule: AutoReplyRule, chatId: string, chatName: string) =>
      expandTemplate(rule.text ?? "", {
        name: chatName,
        phone: /@(c\.us|s\.whatsapp\.net)$/.test(chatId) ? `+${chatId.split("@")[0]}` : "",
      }).trim();

    const aiReply = async (rule: AutoReplyRule, account: string, chatId: string, chatName: string, m: WAMessage, recent: WAMessage[]) => {
      // Always include the trigger message.
      const messages = [...recent.filter((x) => x.id !== m.id), m].sort((a, b) => a.timestamp - b.timestamp).slice(-rule.ai_context);
      // Same keys the chat screens use: `session:chat` for WAHA, `accountId:chat` for native.
      const p = accountParts(account);
      const owner = p?.kind === "native" ? p.id : p?.session;
      const language = owner ? useChatPrefs.getState().autoTranslate[convKey(owner, chatId)]?.out : undefined;
      return aiAutoReply({ instructions: rule.ai_instructions, account, chatName, isGroup: isGroup(chatId), messages, language });
    };

    const handle = async (account: string, chatId: string, m: WAMessage) => {
      const st = useSettings.getState();
      if (st.autoReplyPaused) return;
      if (Date.now() / 1000 - m.timestamp > MAX_AGE_S) return;
      // A redelivered message (offline drain, reconnect) must not be answered twice.
      const seenKey = `${account}:${m.id}`;
      if (handled.current.has(seenKey)) return;
      handled.current.add(seenKey);
      if (handled.current.size > 2000) handled.current.delete(handled.current.values().next().value!);
      const key = `${account}:${chatId}`;
      if (inflight.current.has(key)) return; // one at a time per chat: bursts get one answer
      inflight.current.add(key);
      let rule: AutoReplyRule | undefined;
      let stopTyping: (() => void) | undefined;
      const body = (m.body ?? "").trim();
      const chatName = chatNameFor(m, chatId);
      try {
        const now = Date.now() / 1000;
        const rules = await activeRules(account);
        rule = rules.find((r) => ruleMatches(r, chatId, body));
        if (!rule) return;
        if (rule.cooldown_min > 0) {
          const last = await lastReplyAt(rule.id, chatId);
          if (last && now - last < rule.cooldown_min * 60) return;
        }
        if ((await repliesSince(account, chatId, now - MAX_REPLIES_WINDOW_S)) >= MAX_REPLIES) return;
        if (st.autoReplyDailyLimit > 0 && (await repliesToday(account)) >= st.autoReplyDailyLimit) {
          if (!dailyLimitWarned.current) {
            dailyLimitWarned.current = true;
            if (st.notifications)
              sendNotification({
                title: "Auto-reply daily limit reached",
                body: `${st.autoReplyDailyLimit} replies sent today; no more until midnight. Raise the limit in Auto-reply.`,
              });
          }
          return;
        }
        // Recent context: the cache when the chat is open, else a light fetch (the manual-quiet
        // guard and the AI context both need it; chats never opened here have no cache).
        const recent = await recentMessages(account, chatId, Math.max(20, rule.ai_context));
        if (userRepliedRecently(recent, m)) return;

        // Read (if asked), then "typing…" while the reply is written, like a person would.
        await new Promise((r) => setTimeout(r, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])));
        if (useSettings.getState().autoReplyPaused) return;
        if (rule.mark_seen) await markSeenOn(account, chatId, m.id).catch(() => {});
        if (sendTypingFor(account)) {
          stopTyping = () => {
            clearInterval(refresh);
            void setTypingOn(account, chatId, false).catch(() => {});
          };
          const typing = () => void setTypingOn(account, chatId, true).catch(() => {});
          const refresh = setInterval(typing, TYPING_REFRESH_MS);
          typing();
        }
        const startedAt = Date.now();
        const reply =
          rule.reply_kind === "ai" ? await aiReply(rule, account, chatId, chatName, m, recent) : templateReply(rule, chatId, chatName);
        if (!reply) throw new Error("Empty reply");
        if (stopTyping) {
          const typingFor = Math.min(TYPING_MS[1], Math.max(TYPING_MS[0], reply.length * TYPING_MS_PER_CHAR));
          await new Promise((r) => setTimeout(r, Math.max(0, typingFor - (Date.now() - startedAt))));
        }
        if (useSettings.getState().autoReplyPaused) return;
        await sendTextOn(account, chatId, reply, rule.quote ? m.id : undefined);
        await logReply({
          rule_id: rule.id,
          account,
          session: accountParts(account)?.session ?? "",
          chat_id: chatId,
          chat_name: chatName,
          incoming: body || null,
          reply,
          status: "sent",
          error: null,
        });
      } catch (e) {
        if (rule)
          await logReply({
            rule_id: rule.id,
            account,
            session: accountParts(account)?.session ?? "",
            chat_id: chatId,
            chat_name: chatName,
            incoming: body || null,
            reply: null,
            status: "error",
            error: errMsg(e),
          });
        else console.warn("auto-reply failed", e);
      } finally {
        stopTyping?.();
        inflight.current.delete(key);
        if (rule) qc.invalidateQueries({ queryKey: ["auto-reply"] });
      }
    };

    window.addEventListener("wahana:incoming", onIncoming);
    return () => window.removeEventListener("wahana:incoming", onIncoming);
  }, [qc]);
}

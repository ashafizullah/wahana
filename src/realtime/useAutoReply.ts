import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { sendTypingFor, useSettings } from "@/store/settings";
import { takeoverKey, useChatPrefs } from "@/store/chatPrefs";
import {
  activeRules,
  lastReplyAt,
  logReply,
  repliesSince,
  replyTextsSince,
  repliesToday,
  ruleMatches,
  type AutoReplyRule,
} from "@/store/autoReply";
import { expandTemplate } from "@/store/quickReplies";
import { aiAutoReply, type ReplyMessage } from "@/lib/autoReplyAi";
import { accountId } from "@/lib/account";
import { markSeenOn, sendTextOn, setTypingOn } from "@/lib/send";
import { nativeWa } from "@/lib/nativeWa";
import { displayId, isGroup, errMsg, convKey } from "@/lib/utils";
import type { IncomingMessage } from "@/store/whatsapp";

/** Ignore messages older than this (redelivered bursts after a reconnect). */
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

/**
 * Answers incoming messages according to the account's rules: first enabled rule whose scope,
 * time window and pattern match wins, subject to a per-chat cooldown. Runs while the app is
 * alive (tray is fine).
 */
export function useAutoReply() {
  const qc = useQueryClient();
  const inflight = useRef(new Set<string>()); // "account:chat" currently being answered
  const handled = useRef(new Set<string>()); // "account:messageId" already considered
  const dailyLimitWarned = useRef(false);

  useEffect(() => {
    const onIncoming = (ev: Event) => {
      const { account, chatId, message } = (ev as CustomEvent<IncomingMessage>).detail;
      void handle(account, chatId, message);
    };

    const recentMessages = async (account: string, chatId: string, limit: number): Promise<ReplyMessage[]> => {
      const id = accountId(account);
      if (!id) return [];
      const list = await nativeWa.messages(id, chatId, limit).catch(() => []);
      return list.map((m) => ({
        id: m.id,
        timestamp: Math.floor(m.timestamp / 1000),
        fromMe: m.fromMe,
        from: m.chatId,
        body: m.body,
        hasMedia: !!m.media,
        senderName: m.fromMe ? undefined : m.senderName || undefined,
      }));
    };

    /** The user wrote in this chat within the last `quietMin` minutes — they're handling it (our auto-replies don't count). */
    const userRepliedRecently = async (account: string, chatId: string, recent: ReplyMessage[], m: ReplyMessage, quietMin: number) => {
      if (quietMin <= 0) return false;
      const since = m.timestamp - quietMin * 60;
      const ours = await replyTextsSince(account, chatId, since - 60);
      const mine = recent
        .filter((x) => x.fromMe && x.id !== m.id && x.timestamp > since && !ours.has((x.body ?? "").trim()))
        .reduce((t, x) => Math.max(t, x.timestamp), 0);
      return mine > 0;
    };

    const chatNameFor = (m: ReplyMessage, chatId: string) => (!isGroup(chatId) && m.senderName) || displayId(chatId);

    const templateReply = (rule: AutoReplyRule, chatId: string, chatName: string) =>
      expandTemplate(rule.text ?? "", {
        name: chatName,
        phone: /@(c\.us|s\.whatsapp\.net)$/.test(chatId) ? `+${chatId.split("@")[0]}` : "",
      }).trim();

    const aiReply = async (
      rule: AutoReplyRule,
      account: string,
      chatId: string,
      chatName: string,
      m: ReplyMessage,
      recent: ReplyMessage[],
    ) => {
      // Always include the trigger message.
      const messages = [...recent.filter((x) => x.id !== m.id), m].sort((a, b) => a.timestamp - b.timestamp).slice(-rule.ai_context);
      const owner = accountId(account);
      const language = owner ? useChatPrefs.getState().autoTranslate[convKey(owner, chatId)]?.out : undefined;
      return aiAutoReply({ instructions: rule.ai_instructions, account, chatName, isGroup: isGroup(chatId), messages, language });
    };

    const handle = async (account: string, chatId: string, m: ReplyMessage) => {
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
      // Taken over by the user: stay out until they release it (re-checked before sending).
      const takenOver = () => !!useChatPrefs.getState().takeover[takeoverKey(account, chatId)];
      try {
        const now = Date.now() / 1000;
        if (takenOver()) return;
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
        // Recent context: local history; the manual-quiet guard and the AI context both need it.
        const recent = await recentMessages(account, chatId, Math.max(20, rule.ai_context));
        if (await userRepliedRecently(account, chatId, recent, m, st.autoReplyManualQuietMin)) return;

        // Read (if asked), then "typing…" while the reply is written, like a person would.
        await new Promise((r) => setTimeout(r, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])));
        if (useSettings.getState().autoReplyPaused || takenOver()) return;
        if (rule.mark_seen) await markSeenOn(account, chatId).catch(() => {});
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
        if (useSettings.getState().autoReplyPaused || takenOver()) return;
        await sendTextOn(account, chatId, reply, rule.quote ? m.id : undefined);
        await logReply({
          rule_id: rule.id,
          account,
          session: "",
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
            session: "",
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

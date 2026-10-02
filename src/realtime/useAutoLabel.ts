import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clientForProfile, useSettings } from "@/store/settings";
import { aiConfigured, suggestLabels } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import { displayId, isChannel, isGroup, convKey } from "@/lib/utils";
import { accountParts } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";
import { nativeTranscript } from "@/screens/whatsapp/NativeAi";
import { useWhatsApp } from "@/store/whatsapp";
import type { IncomingMessage } from "@/realtime/useWahaSocket";
import { qk } from "@/api/queries";

/** Ignore replays / reconnect bursts. */
const MAX_AGE_S = 120;

/**
 * Opt-in (Settings → AI → "Label new chats automatically"): when a message arrives in a
 * direct chat that has no labels yet, ask the model which of the *existing* labels fit
 * and assign them. Never creates labels, never touches chats that already have one;
 * one attempt per chat per app run (both to bound cost and to stay predictable).
 */
export function useAutoLabel() {
  const enabled = useSettings((s) => s.aiAutoLabel);
  const qc = useQueryClient();
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const onIncoming = (ev: Event) => {
      const { account, chatId, message } = (ev as CustomEvent<IncomingMessage>).detail;
      if (!aiConfigured() || isGroup(chatId) || isChannel(chatId) || chatId === "status@broadcast") return;
      if (Date.now() / 1000 - message.timestamp > MAX_AGE_S) return;
      const key = convKey(account, chatId);
      if (tried.current.has(key)) return;
      tried.current.add(key);
      const p = accountParts(account);
      const job =
        p?.kind === "native" && p.id ? handleNative(p.id, chatId) : p?.kind === "waha" ? handleWaha(p.profile, p.session, chatId) : null;
      void job?.catch((e) => console.warn("auto-label failed", e));
    };
    const handleWaha = async (profile: string | undefined, session: string | undefined, chatId: string) => {
      if (session === undefined) return;
      const c = await clientForProfile(profile);
      const [labels, current] = await Promise.all([c.labels(session), c.chatLabels(session, chatId)]);
      if (!labels.length || current.length) return;
      const msgs = await c.messages(session, chatId, { limit: 30, downloadMedia: false });
      const usable = msgs.filter((x) => x.body || x.hasMedia);
      if (usable.length < 2) return; // a lone "hi" is not enough to classify
      const chats = qc.getQueryData<{ id: string; name?: string | null }[]>(qk.chats(session));
      const chatName = chats?.find((x) => x.id === chatId)?.name || displayId(chatId);
      const s = await suggestLabels(
        transcript(usable, () => undefined),
        {
          chatName,
          existing: labels.map((l) => l.name),
          language: useSettings.getState().aiTranslateTo,
        },
      );
      const ids = labels.filter((l) => s.labels.includes(l.name)).map((l) => l.id);
      if (!ids.length) return;
      await c.setChatLabels(session, chatId, ids);
      qc.invalidateQueries({ queryKey: ["chat-labels", session, chatId] });
      qc.invalidateQueries({ queryKey: ["label-map", session] });
    };
    const handleNative = async (id: string, chatId: string) => {
      const [labels, current] = await Promise.all([nativeWa.labels(id), nativeWa.chatLabels(id, chatId)]);
      if (!labels.length || current.length) return;
      const msgs = (await nativeWa.messages(id, chatId, 30)).filter((x) => x.kind !== "unsupported" && (x.body || x.media));
      if (msgs.length < 2) return;
      const chatName = msgs.find((x) => !x.fromMe)?.senderName || displayId(chatId);
      const s = await suggestLabels(nativeTranscript(msgs), {
        chatName,
        existing: labels.map((l) => l.name),
        language: useSettings.getState().aiTranslateTo,
      });
      const ids = labels.filter((l) => s.labels.includes(l.name)).map((l) => l.id);
      if (!ids.length) return;
      for (const labelId of ids) await nativeWa.labelLink(id, labelId, chatId, true);
      useWhatsApp.setState((st) => ({ labelsTick: st.labelsTick + 1 }));
    };
    window.addEventListener("wahana:incoming", onIncoming);
    return () => window.removeEventListener("wahana:incoming", onIncoming);
  }, [enabled, qc]);
}

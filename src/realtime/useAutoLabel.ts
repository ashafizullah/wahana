import { useEffect, useRef } from "react";
import { useSettings } from "@/store/settings";
import { aiConfigured, suggestLabels } from "@/lib/ai";
import { displayId, isChannel, isGroup, convKey } from "@/lib/utils";
import { accountId } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";
import { nativeTranscript } from "@/screens/whatsapp/NativeAi";
import { useWhatsApp } from "@/store/whatsapp";
import type { IncomingMessage } from "@/store/whatsapp";

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
      const id = accountId(account);
      if (!id) return;
      void handleNative(id, chatId).catch((e) => console.warn("auto-label failed", e));
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
  }, [enabled]);
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { aiConfigured, suggestLabels } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import { displayId, isChannel, isGroup, convKey } from "@/lib/utils";
import type { IncomingMessage } from "@/realtime/useWahaSocket";
import type { WAMessage } from "@/api/types";
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
  const client = useSettings((s) => s.client);
  const enabled = useSettings((s) => s.aiAutoLabel);
  const qc = useQueryClient();
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!client || !enabled) return;
    const onIncoming = (ev: Event) => {
      const { session, chatId, message } = (ev as CustomEvent<IncomingMessage>).detail;
      void handle(session, chatId, message);
    };
    const handle = async (session: string, chatId: string, m: WAMessage) => {
      if (!aiConfigured() || isGroup(chatId) || isChannel(chatId) || chatId === "status@broadcast") return;
      if (Date.now() / 1000 - m.timestamp > MAX_AGE_S) return;
      const key = convKey(session, chatId);
      if (tried.current.has(key)) return;
      tried.current.add(key);
      const c = useSettings.getState().client;
      if (!c) return;
      try {
        const [labels, current] = await Promise.all([c.labels(session), c.chatLabels(session, chatId)]);
        if (!labels.length || current.length) return;
        const msgs = await c.messages(session, chatId, { limit: 30, downloadMedia: false });
        const usable = msgs.filter((x) => x.body || x.hasMedia);
        if (usable.length < 2) return; // a lone "hi" is not enough to classify
        const chats = qc.getQueryData<{ id: string; name?: string | null }[]>(qk.chats(session));
        const chatName = chats?.find((x) => x.id === chatId)?.name || displayId(chatId);
        const s = await suggestLabels(
          transcript(usable, () => undefined),
          { chatName, existing: labels.map((l) => l.name), language: useSettings.getState().aiTranslateTo },
        );
        const ids = labels.filter((l) => s.labels.includes(l.name)).map((l) => l.id);
        if (!ids.length) return;
        await c.setChatLabels(session, chatId, ids);
        qc.invalidateQueries({ queryKey: ["chat-labels", session, chatId] });
        qc.invalidateQueries({ queryKey: ["label-map", session] });
      } catch (e) {
        console.warn("auto-label failed", e);
      }
    };
    window.addEventListener("wahana:incoming", onIncoming);
    return () => window.removeEventListener("wahana:incoming", onIncoming);
  }, [client, enabled, qc]);
}

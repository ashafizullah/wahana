import { useEffect, useMemo, useRef } from "react";
import type { ViewMessage, WAMessage } from "@/api/types";
import { aiConfigured, translate } from "@/lib/ai";
import { convKey, errMsg } from "@/lib/utils";
import { useHidden } from "@/store/hidden";
import { useLiveMessages } from "@/store/liveMessages";
import { bareId } from "@/store/reactions";
import { tombstonesFor, useRevoked } from "@/store/revoked";
import { useTranslations } from "@/store/translations";

/**
 * The list the conversation renders: the cached API pages (newest-first) sorted oldest-first,
 * minus messages deleted "for me", plus messages only seen live and revoke / waiting placeholders.
 */
export function useOrderedMessages(session: string, chatId: string, messages: WAMessage[] | undefined): ViewMessage[] {
  const hiddenIds = useHidden((s) => s.ids);
  const revokedItems = useRevoked((s) => s.items);
  const live = useLiveMessages((s) => s.byChat[convKey(session, chatId)]);
  return useMemo(() => {
    const list: ViewMessage[] = (messages ?? []).filter((m) => !hiddenIds[m.id]);
    // Messages we received live but the server no longer returns (WAHA storage gaps): keep them in the loaded range.
    if (live?.length && messages) {
      const have = new Set(list.map((m) => m.id));
      const oldest = list.length ? Math.min(...list.map((m) => m.timestamp)) : 0;
      for (const m of live) if (!have.has(m.id) && !hiddenIds[m.id] && m.timestamp >= oldest) list.push(m);
    }
    const stones = tombstonesFor(revokedItems, convKey(session, chatId));
    if (stones.length) {
      const have = new Map(list.map((m) => [bareId(m.id), m]));
      const oldest = list.length ? Math.min(...list.map((m) => m.timestamp)) : 0;
      for (const t of stones) {
        const existing = have.get(t.id);
        if (existing) {
          // Never mutate the react-query cache object: replace it with a flagged copy.
          if ((t.kind ?? "revoked") === "revoked" && !existing.revoked) list[list.indexOf(existing)] = { ...existing, revoked: true };
          continue; // the real message arrived → no "waiting" placeholder needed
        }
        if (t.timestamp >= oldest) {
          // Synthesize a placeholder in the loaded range so it keeps its position.
          list.push({
            id: `revoked_${chatId}_${t.id}`,
            timestamp: t.timestamp,
            from: t.from ?? chatId,
            to: chatId,
            fromMe: t.fromMe,
            participant: t.participant ?? "",
            body: "",
            hasMedia: false,
            ack: 0,
            ackName: "",
            source: "app",
            mediaUrl: "",
            revoked: (t.kind ?? "revoked") === "revoked",
            waiting: t.kind === "waiting",
          } as ViewMessage);
        }
      }
    }
    return list.sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, hiddenIds, revokedItems, session, chatId, live]);
}

/** Auto-translate incoming: the newest incoming messages that have no translation yet. Each id is tried once per target. */
export function useAutoTranslateIncoming(ordered: ViewMessage[], target: string | undefined) {
  const tried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!target || !aiConfigured()) return;
    const t = useTranslations.getState();
    const todo = [...ordered]
      .reverse()
      .filter((m) => !m.fromMe && m.body && !m.waiting)
      .slice(0, 20)
      .filter((m) => !t.byMsg[m.id] && !tried.current.has(`${target}:${m.id}`));
    for (const m of todo) {
      tried.current.add(`${target}:${m.id}`);
      t.set(m.id, { target, loading: true });
      translate(m.body, target, m.id)
        .then((text) => useTranslations.getState().set(m.id, { target, text }))
        .catch((e) => useTranslations.getState().set(m.id, { target, error: errMsg(e) }));
    }
  }, [ordered, target]);
}

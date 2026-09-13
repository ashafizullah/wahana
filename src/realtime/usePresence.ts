import { useEffect, useState } from "react";
import { useSettings } from "@/store/settings";
import type { PresenceInfo, PresenceStatus } from "@/api/types";

type Entry = { status: PresenceStatus; lastSeen?: number | null };
type Listener = (chatId: string, participant: string, e: Entry) => void;

const listeners = new Set<Listener>();
/** Called from the WebSocket hook on `presence.update`. */
export function pushPresence(p: PresenceInfo) {
  for (const x of p.presences) {
    listeners.forEach((l) => l(p.id, x.participant, { status: x.lastKnownPresence, lastSeen: x.lastSeen }));
  }
}

/**
 * Presence for one chat: subscribes on the server and listens to WS updates.
 * For groups, returns the participants currently typing.
 */
export function usePresence(session: string, chatId: string) {
  const client = useSettings((s) => s.client);
  const [map, setMap] = useState<Record<string, Entry>>({});

  useEffect(() => {
    if (!client) return;
    setMap({});
    let alive = true;
    (async () => {
      try {
        await client.subscribePresence(session, chatId);
        const p = await client.presence(session, chatId);
        if (!alive) return;
        const next: Record<string, Entry> = {};
        for (const x of p.presences) next[x.participant] = { status: x.lastKnownPresence, lastSeen: x.lastSeen };
        setMap(next);
      } catch {
        /* presence is best-effort */
      }
    })();
    const l: Listener = (id, participant, e) => {
      if (id !== chatId) return;
      setMap((m) => ({ ...m, [participant]: e }));
    };
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, [client, session, chatId]);

  return map;
}

/** Human label for the header, e.g. "online", "typing…", "last seen 12:30". */
export function presenceLabel(map: Record<string, Entry>, chatId: string, isGroup: boolean, nameOf: (id: string) => string) {
  const entries = Object.entries(map);
  if (isGroup) {
    const typing = entries.filter(([, e]) => e.status === "typing" || e.status === "recording").map(([id]) => nameOf(id));
    if (typing.length) return `${typing.slice(0, 2).join(", ")}${typing.length > 2 ? ` +${typing.length - 2}` : ""} typing…`;
    return null;
  }
  const e = map[chatId] ?? entries[0]?.[1];
  if (!e) return null;
  if (e.status === "typing") return "typing…";
  if (e.status === "recording") return "recording audio…";
  if (e.status === "online") return "online";
  if (e.lastSeen) {
    const d = new Date(e.lastSeen * 1000);
    const today = d.toDateString() === new Date().toDateString();
    return `last seen ${today ? "" : d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " "}${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return null;
}

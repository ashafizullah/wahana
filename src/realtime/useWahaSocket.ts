import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import type { WahaEvent, WAMessage, MessageAckPayload, SessionStatusPayload } from "@/api/types";
import { notifyIncoming } from "@/realtime/notify";
import { qk } from "@/api/queries";
import { useUnread } from "@/store/unread";
import { useEventLog } from "@/store/eventLog";
import { messageChatId } from "@/lib/utils";
import { pushPresence } from "@/realtime/usePresence";
import type { PresenceInfo } from "@/api/types";

export type SocketState = "idle" | "connecting" | "open" | "closed";

const EVENTS = ["session.status", "message.any", "message.ack", "message.reaction", "message.revoked", "message.edited", "presence.update"];

/**
 * Keeps a single WebSocket to WAHA's /ws endpoint and pushes events into the
 * TanStack Query cache so UI updates in realtime. Reconnects with backoff.
 */
export function useWahaSocket() {
  const client = useSettings((s) => s.client);
  const notifications = useSettings((s) => s.notifications);
  const qc = useQueryClient();
  const [state, setState] = useState<SocketState>("idle");
  const notifRef = useRef(notifications);
  notifRef.current = notifications;

  useEffect(() => {
    if (!client) {
      setState("idle");
      return;
    }
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      setState("connecting");
      const url = new URL(client.wsUrl);
      url.searchParams.set("x-api-key", client.apiKey);
      url.searchParams.set("session", "*");
      EVENTS.forEach((e) => url.searchParams.append("events", e));
      ws = new WebSocket(url.toString());

      ws.onopen = () => {
        attempt = 0;
        setState("open");
      };
      ws.onmessage = (ev) => {
        let data: WahaEvent;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        handle(data);
      };
      ws.onclose = () => {
        setState("closed");
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    const handle = (e: WahaEvent) => {
      useEventLog.getState().push(e);
      switch (e.event) {
        case "session.status": {
          const p = e.payload as SessionStatusPayload;
          qc.setQueryData(qk.sessions, (old?: { name: string; status: string }[]) =>
            old?.map((s) => (s.name === p.name ? { ...s, status: p.status } : s)),
          );
          qc.invalidateQueries({ queryKey: qk.sessions });
          break;
        }
        case "message.any": {
          const m = e.payload as WAMessage;
          const chatId = messageChatId(m);
          if (!m.fromMe) useUnread.getState().incoming(e.session, chatId);
          for (const id of new Set([chatId, m.from, m.to].filter(Boolean))) {
            qc.setQueryData(qk.messages(e.session, id), (old?: WAMessage[]) => {
              if (!old) return old;
              if (old.some((x) => x.id === m.id)) return old.map((x) => (x.id === m.id ? m : x));
              return [m, ...old];
            });
          }
          qc.invalidateQueries({ queryKey: qk.chats(e.session) });
          if (!m.fromMe && notifRef.current) void notifyIncoming(m);
          break;
        }
        case "message.ack": {
          const p = e.payload as MessageAckPayload;
          for (const id of new Set([p.from, p.to].filter(Boolean))) {
            qc.setQueryData(qk.messages(e.session, id), (old?: WAMessage[]) =>
              old?.map((x) => (x.id === p.id ? { ...x, ack: p.ack as WAMessage["ack"], ackName: p.ackName } : x)),
            );
          }
          break;
        }
        case "presence.update": {
          pushPresence(e.payload as PresenceInfo);
          break;
        }
        case "message.revoked":
        case "message.edited":
        case "message.reaction": {
          qc.invalidateQueries({ queryKey: ["messages", e.session] });
          qc.invalidateQueries({ queryKey: qk.chats(e.session) });
          break;
        }
      }
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [client, qc]);

  return state;
}

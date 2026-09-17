import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import type { WahaEvent, WAMessage, MessageAckPayload, PresenceInfo, SessionStatusPayload } from "@/api/types";
import { notifyIncoming } from "@/realtime/notify";
import { qk } from "@/api/queries";
import { useUnread } from "@/store/unread";
import { useEventLog } from "@/store/eventLog";
import { usePushNames } from "@/store/pushNames";
import { useReactions, type ReactionEvent } from "@/store/reactions";
import { useReceipts, type AckEvent } from "@/store/receipts";
import { useRevoked } from "@/store/revoked";
import { usePolls, type PollVoteEvent } from "@/store/polls";
import { useChatPrefs } from "@/store/chatPrefs";
import { useCalls, type CallEvent } from "@/store/calls";
import { useLiveMessages } from "@/store/liveMessages";
import { convKey, messageChatId } from "@/lib/utils";
import { useLatest } from "@/lib/hooks";
import { pushPresence } from "@/realtime/usePresence";

export type SocketState = "idle" | "connecting" | "open" | "closed";

const EVENTS = [
  "session.status",
  "message.any",
  "message.waiting",
  "message.ack",
  "message.ack.group",
  "message.reaction",
  "message.revoked",
  "message.edited",
  "presence.update",
  "engine.event",
  "poll.vote",
  "chat.archive",
  "call.received",
  "call.accepted",
  "call.rejected",
];

/**
 * Keeps a single WebSocket to WAHA's /ws endpoint and pushes events into the
 * TanStack Query cache so UI updates in realtime. Reconnects with backoff.
 */
/** Fired on `window` as "wahana:incoming" for every message someone else sent (auto-reply listens). */
export interface IncomingMessage {
  session: string;
  chatId: string;
  message: WAMessage;
}

export function useWahaSocket() {
  const client = useSettings((s) => s.client);
  const notifications = useSettings((s) => s.notifications);
  const qc = useQueryClient();
  const [state, setState] = useState<SocketState>("idle");
  const notifRef = useLatest(notifications);

  useEffect(() => {
    if (!client) {
      setState("idle");
      return;
    }
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let everOpened = false;
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
        if (everOpened) {
          // Events sent while we were disconnected are gone: refetch what is on screen.
          qc.invalidateQueries({ queryKey: qk.sessions });
          qc.invalidateQueries({ queryKey: ["chats"] });
          qc.invalidateQueries({ queryKey: ["messages"] });
        }
        everOpened = true;
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

    // A socket left half-open by sleep/wake or a NAT timeout never fires onclose: force a
    // reconnect when the network comes back or the window is used again after a long idle.
    let hiddenAt = 0;
    const kick = () => {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;
      attempt = 0;
      ws.close();
    };
    const onOnline = () => kick();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) kick();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    const handle = (e: WahaEvent) => {
      // Raw engine events are only used to detect undecryptable messages; keep receipts out of the log.
      if (e.event === "engine.event") {
        const p = e.payload as {
          event?: string;
          data?: { Info?: { Chat?: string; Sender?: string; SenderAlt?: string; ID?: string; Timestamp?: string; IsFromMe?: boolean } };
        };
        if (p.event === "events.UndecryptableMessage" && p.data?.Info) {
          useEventLog.getState().push(e);
          const i = p.data.Info;
          let chat = i.Chat ?? "";
          if (chat.endsWith("@lid") && i.SenderAlt) chat = i.SenderAlt.replace(/:\d+/, "").replace(/@s\.whatsapp\.net$/, "@c.us");
          useRevoked.getState().add({
            kind: "waiting",
            id: i.ID ?? "",
            chat: `${e.session}:${chat}`,
            timestamp: i.Timestamp ? Math.floor(new Date(i.Timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
            fromMe: !!i.IsFromMe,
            participant: i.Sender?.replace(/:\d+@/, "@") ?? null,
            from: chat,
          });
        }
        return;
      }
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
          let chatId = messageChatId(m);
          usePushNames.getState().learn([m]);
          // Prefer the id the chat list uses (LID vs phone) so badges line up with rows.
          const known = qc.getQueryData<{ id: string }[]>(qk.chats(e.session));
          if (known && !known.some((c) => c.id === chatId)) {
            const digits = chatId.split("@")[0];
            const alt = [m.from, m.to, (m._data as { Info?: { SenderAlt?: string; Chat?: string } } | undefined)?.Info?.SenderAlt]
              .filter((x): x is string => !!x)
              .map((x) => x.replace(/@s\.whatsapp\.net$/, "@c.us"));
            const match = known.find((c) => c.id === alt.find((a) => a === c.id) || c.id.split("@")[0] === digits);
            if (match) chatId = match.id;
          }
          // Replays / duplicate deliveries: the caches dedupe by id, so the counters and notifications must too.
          const seenBefore =
            !!qc.getQueryData<WAMessage[]>(qk.messages(e.session, chatId))?.some((x) => x.id === m.id) ||
            !!useLiveMessages.getState().byChat[convKey(e.session, chatId)]?.some((x) => x.id === m.id);
          if (!m.fromMe && !seenBefore) useUnread.getState().incoming(e.session, chatId);
          useRevoked.getState().remove(convKey(e.session, chatId), m.id);
          useLiveMessages.getState().add(e.session, chatId, m);
          for (const id of new Set([chatId, m.from, m.to].filter(Boolean))) {
            qc.setQueryData(qk.messages(e.session, id), (old?: WAMessage[]) => {
              if (!old) return old;
              if (old.some((x) => x.id === m.id)) return old.map((x) => (x.id === m.id ? m : x));
              return [m, ...old];
            });
          }
          qc.invalidateQueries({ queryKey: qk.chats(e.session) });
          if (!m.fromMe && !seenBefore && notifRef.current && !useChatPrefs.getState().muted[convKey(e.session, chatId)]) {
            const multi = (qc.getQueryData<{ name: string }[]>(qk.sessions)?.length ?? 0) > 1;
            void notifyIncoming(m, multi ? e.session : undefined);
          }
          if (!m.fromMe && !seenBefore)
            window.dispatchEvent(
              new CustomEvent<IncomingMessage>("wahana:incoming", { detail: { session: e.session, chatId, message: m } }),
            );
          break;
        }
        case "message.ack.group": {
          const p = e.payload as AckEvent;
          useReceipts.getState().apply(p, e.timestamp > 1e12 ? e.timestamp : e.timestamp * 1000, true);
          break;
        }
        case "message.ack": {
          const p = e.payload as MessageAckPayload;
          useReceipts.getState().apply(p as AckEvent, e.timestamp > 1e12 ? e.timestamp : e.timestamp * 1000);
          for (const id of new Set([p.from, p.to].filter(Boolean))) {
            qc.setQueryData(qk.messages(e.session, id), (old?: WAMessage[]) =>
              old?.map((x) => (x.id === p.id ? { ...x, ack: p.ack as WAMessage["ack"], ackName: p.ackName } : x)),
            );
          }
          break;
        }
        case "poll.vote": {
          usePolls.getState().apply(e.payload as PollVoteEvent);
          break;
        }
        case "chat.archive": {
          const p = e.payload as { id: string; archived: boolean };
          useChatPrefs.getState().toggle("archived", `${e.session}:${p.id}`, p.archived);
          qc.invalidateQueries({ queryKey: qk.chats(e.session) });
          break;
        }
        case "call.received":
        case "call.accepted":
        case "call.rejected": {
          useCalls.getState().apply(e.session, e.event, e.payload as CallEvent);
          break;
        }
        case "presence.update": {
          pushPresence(e.payload as PresenceInfo);
          break;
        }
        case "message.reaction": {
          useReactions.getState().apply(e.payload as ReactionEvent);
          break;
        }
        case "message.revoked": {
          const p = e.payload as { revokedMessageId?: string; before?: WAMessage | null; after?: WAMessage | null };
          const ref = p.before ?? p.after;
          if (ref) {
            const chatId = messageChatId(ref);
            useRevoked.getState().add({
              id: p.revokedMessageId ?? ref.id,
              chat: convKey(e.session, chatId),
              timestamp: p.before?.timestamp ?? ref.timestamp,
              fromMe: ref.fromMe,
              participant: ref.participant,
              from: ref.from,
            });
          }
          qc.invalidateQueries({ queryKey: ["messages", e.session] });
          qc.invalidateQueries({ queryKey: qk.chats(e.session) });
          break;
        }
        case "message.edited": {
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
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      ws?.close();
    };
  }, [client, qc, notifRef]);

  return state;
}

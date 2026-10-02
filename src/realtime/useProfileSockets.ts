import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { clientForProfile, useSettings } from "@/store/settings";
import { wahaRuleProfiles } from "@/store/autoReply";
import { wahaAccountKey } from "@/lib/account";
import { messageChatId } from "@/lib/utils";
import type { WahaEvent, WAMessage } from "@/api/types";
import type { IncomingMessage } from "@/realtime/useWahaSocket";

/**
 * `useWahaSocket` only listens to the active WAHA server. Auto-reply rules of the other servers
 * still need their incoming messages, so keep a slim `message.any` socket open to each of them
 * that has an enabled rule, and feed the same "wahana:incoming" event.
 */
export function useProfileSockets() {
  const active = useSettings((s) => s.activeProfile);
  const profiles = useSettings((s) => s.profiles);
  const { data: withRules = [] } = useQuery({
    queryKey: ["auto-reply", "waha-profiles"],
    queryFn: wahaRuleProfiles,
    refetchInterval: 60_000,
  });
  const targets = withRules
    .filter((id) => id !== active && profiles.some((p) => p.id === id))
    .sort()
    .join(",");

  useEffect(() => {
    if (!targets) return;
    const stops = targets.split(",").map(listen);
    return () => stops.forEach((stop) => stop());
  }, [targets]);
}

/** Opens and keeps reconnecting one background socket; returns its stop function. */
function listen(profile: string): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const retry = () => {
    if (closed) return;
    timer = setTimeout(connect, Math.min(60_000, 1000 * 2 ** attempt++));
  };

  const connect = async () => {
    if (closed) return;
    let url: URL;
    try {
      const c = await clientForProfile(profile);
      url = new URL(c.wsUrl);
      url.searchParams.set("x-api-key", c.apiKey);
    } catch (e) {
      console.warn(`auto-reply socket for ${profile} unavailable`, e);
      return retry();
    }
    if (closed) return;
    url.searchParams.set("session", "*");
    url.searchParams.append("events", "message.any");
    ws = new WebSocket(url.toString());
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (ev) => {
      let e: WahaEvent;
      try {
        e = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (e.event !== "message.any") return;
      const m = e.payload as WAMessage;
      if (m.fromMe) return;
      window.dispatchEvent(
        new CustomEvent<IncomingMessage>("wahana:incoming", {
          detail: { account: wahaAccountKey(profile, e.session), chatId: messageChatId(m), message: m },
        }),
      );
    };
    ws.onclose = retry;
    ws.onerror = () => ws?.close();
  };

  void connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { db } from "@/store/scheduler";
import { getBroadcast, markItem, nextPending, setBroadcastStatus, type Broadcast } from "@/store/broadcast";
import { expandTemplate } from "@/store/quickReplies";
import { sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Sends the next pending recipient of every `running` broadcast, waiting a
 * random delay between recipients (anti-spam). Runs while the app is alive.
 */
export function useBroadcastRunner() {
  const client = useSettings((s) => s.client);
  const qc = useQueryClient();
  const busy = useRef(false);
  const nextAt = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!client) return;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const running = await (await db()).select<Broadcast[]>("SELECT * FROM broadcasts WHERE status = 'running'");
        for (const b of running) {
          if ((nextAt.current[b.id] ?? 0) > Date.now()) continue;
          const item = await nextPending(b.id);
          if (!item) {
            await setBroadcastStatus(b.id, "done");
            if (useSettings.getState().notifications) sendNotification({ title: "Broadcast finished", body: b.name ?? b.id });
            qc.invalidateQueries({ queryKey: ["broadcasts"] });
            continue;
          }
          const c = useSettings.getState().client;
          if (!c) break;
          const ctx = { name: item.name ?? item.chat_id.split("@")[0], phone: item.chat_id.endsWith("@c.us") ? `+${item.chat_id.split("@")[0]}` : "" };
          const text = b.text ? expandTemplate(b.text, ctx) : "";
          const file = b.media_b64 ? { mimetype: b.media_mime ?? "application/octet-stream", filename: b.media_name ?? "file", data: b.media_b64 } : null;
          try {
            let res: { id?: string } | undefined;
            if (b.kind === "image" && file) res = await c.sendImage(b.session, item.chat_id, file, text || undefined);
            else if (b.kind === "video" && file) res = await c.sendVideo(b.session, item.chat_id, file, text || undefined);
            else if (b.kind === "file" && file) res = await c.sendFile(b.session, item.chat_id, file, text || undefined);
            else res = await c.sendText(b.session, item.chat_id, text);
            await markItem(item.id, "sent", undefined, res?.id);
          } catch (e) {
            await markItem(item.id, "error", e instanceof Error ? e.message : String(e));
          }
          const wait = b.delay_min + Math.random() * Math.max(0, b.delay_max - b.delay_min);
          nextAt.current[b.id] = Date.now() + wait * 1000;
          qc.invalidateQueries({ queryKey: ["broadcast-items", b.id] });
          qc.invalidateQueries({ queryKey: ["broadcasts"] });
        }
      } catch (e) {
        console.warn("broadcast tick failed", e);
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [client, qc]);
}

export { getBroadcast };

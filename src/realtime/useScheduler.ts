import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { claimRun, dueSchedules, nextOccurrence, recordRun, type Schedule } from "@/store/scheduler";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { qk } from "@/api/queries";
import { errMsg } from "@/lib/utils";

/** Jobs later than this are marked missed instead of sent (app was closed). */
export const GRACE_SECONDS = 60 * 60;
const TICK_MS = 20_000;

async function execute(s: Schedule) {
  const client = useSettings.getState().client;
  if (!client) throw new Error("not connected");
  const file = s.media_b64
    ? { mimetype: s.media_mime ?? "application/octet-stream", filename: s.media_name ?? "file", data: s.media_b64 }
    : null;
  const text = s.text ?? "";
  if (s.target_type === "status") {
    if (s.kind === "image" && file) return client.postImageStatus(s.session, file, text || undefined);
    if (s.kind === "video" && file) return client.postVideoStatus(s.session, file, text || undefined);
    return client.postTextStatus(s.session, text);
  }
  const chatId = s.target_id!;
  if (s.kind === "image" && file) return client.sendImage(s.session, chatId, file, text || undefined);
  if (s.kind === "video" && file) return client.sendVideo(s.session, chatId, file, text || undefined);
  if (s.kind === "file" && file) return client.sendFile(s.session, chatId, file, text || undefined);
  return client.sendText(s.session, chatId, text);
}

/** Runs due schedules while the app is alive (window may be hidden in the tray). */
export function useScheduler() {
  const client = useSettings((s) => s.client);
  const profile = useSettings((s) => s.activeProfile);
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!client) return;
    const tick = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const now = Math.floor(Date.now() / 1000);
        const due = (await dueSchedules(now)).filter((s) => s.profile === profile);
        for (const s of due) {
          const late = now - s.next_run;
          const next = nextOccurrence(s, now);
          // Claim first, send second: never send twice (second instance, crash after send).
          if (!(await claimRun(s, next))) continue;
          if (late > GRACE_SECONDS) {
            await recordRun(s, "missed", { error: `Missed by ${Math.round(late / 60)} min (app was not running)` });
            continue;
          }
          try {
            const res = (await execute(s)) as { id?: string } | undefined;
            await recordRun(s, "ok", { messageId: res?.id });
            if (s.target_id) qc.invalidateQueries({ queryKey: qk.chats(s.session) });
          } catch (e) {
            const msg = errMsg(e);
            await recordRun(s, "error", { error: msg });
            if (useSettings.getState().notifications)
              sendNotification({
                title: "Scheduled message failed",
                body: `${s.target_name ?? s.target_id ?? "status"}: ${msg}`.slice(0, 200),
              });
          }
        }
        if (due.length) qc.invalidateQueries({ queryKey: ["schedules"] });
      } catch (e) {
        console.warn("scheduler tick failed", e);
      } finally {
        running.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, [client, profile, qc]);
}

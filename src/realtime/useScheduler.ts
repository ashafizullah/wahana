import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { postStatusMediaOn, postStatusTextOn, sendMediaOn, sendTextOn, type SendOutcome } from "@/lib/send";
import { useSettings } from "@/store/settings";
import { claimRun, dueSchedules, nextOccurrence, recordRun, type Schedule } from "@/store/scheduler";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { errMsg } from "@/lib/utils";

/** Jobs later than this are marked missed instead of sent (app was closed). */
export const GRACE_SECONDS = 60 * 60;
const TICK_MS = 20_000;

async function execute(s: Schedule): Promise<SendOutcome | void> {
  const file = s.media_b64
    ? { mimetype: s.media_mime ?? "application/octet-stream", name: s.media_name ?? "file", base64: s.media_b64 }
    : null;
  const text = s.text ?? "";
  if (s.target_type === "status") {
    if (file && (s.kind === "image" || s.kind === "video")) return postStatusMediaOn(s.account, file, text);
    return postStatusTextOn(s.account, text);
  }
  const chatId = s.target_id!;
  if (file && s.kind !== "text") return sendMediaOn(s.account, chatId, file, text);
  return sendTextOn(s.account, chatId, text);
}

/** Runs due schedules of every account while the app is alive (window may be hidden in the tray). */
export function useScheduler() {
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const now = Math.floor(Date.now() / 1000);
        const due = await dueSchedules(now);
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
            const res = (await execute(s)) as SendOutcome | undefined;
            await recordRun(s, "ok", { messageId: res?.id });
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
  }, [qc]);
}

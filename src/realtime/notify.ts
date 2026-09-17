import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { WAMessage } from "@/api/types";

let granted: boolean | null = null;

async function ensurePermission() {
  if (granted === null) {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  }
  return granted;
}

/** `session` is appended to the title when given (shown only when the server has several sessions). */
export async function notifyIncoming(m: WAMessage, session?: string) {
  if (!(await ensurePermission())) return;
  const data = (m._data ?? {}) as { Info?: { PushName?: string } };
  const title = (data.Info?.PushName || m.from.split("@")[0]!) + (session ? ` · ${session}` : "");
  const body = m.body || (m.hasMedia ? "📎 Media" : "New message");
  sendNotification({ title, body: body.slice(0, 200) });
}

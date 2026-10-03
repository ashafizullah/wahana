import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

async function ensurePermission() {
  if (granted === null) {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  }
  return granted;
}

export async function notifyText(title: string, body: string) {
  if (!(await ensurePermission())) return;
  sendNotification({ title, body: body.slice(0, 200) });
}

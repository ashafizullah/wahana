import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";

/** Mirror the unread total onto the dock/taskbar badge and tray tooltip. */
export function useBadge(unread: number) {
  useEffect(() => {
    const win = getCurrentWindow();
    win.setBadgeCount(unread > 0 ? unread : undefined).catch(() => {});
    TrayIcon.getById("main")
      .then((tray) => {
        if (!tray) return;
        void tray.setTooltip(unread > 0 ? `Wahana — ${unread} unread` : "Wahana");
        // macOS shows a text label beside the tray icon.
        void tray.setTitle(unread > 0 ? String(unread) : null).catch(() => {});
      })
      .catch(() => {});
  }, [unread]);
}

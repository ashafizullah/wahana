import { Toggle } from "./shared";
import { useSettings } from "@/store/settings";

export function NotificationsSection() {
  const s = useSettings();
  return (
    <Toggle
      label="Desktop notifications"
      hint="Show a system notification for incoming messages from any session."
      checked={s.notifications}
      onChange={(v) => s.save({ notifications: v })}
    />
  );
}

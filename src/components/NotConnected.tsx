import { Plug } from "lucide-react";
import { Button } from "./ui";
import { useSettings } from "../store/settings";

/** Ask App to switch to the Settings tab from anywhere in the tree. */
export const openSettings = () => window.dispatchEvent(new CustomEvent("wahana:open-settings"));

/** Placeholder for screens that need a WAHA server, explaining what is missing. */
export function NotConnected({ children }: { children?: React.ReactNode }) {
  const { profiles, baseUrl, apiKey } = useSettings();
  const hint =
    profiles.length === 0
      ? "No WAHA server yet. Add your server URL and API key in Settings → Servers."
      : !baseUrl
        ? "The selected server has no URL. Fill it in under Settings → Connection."
        : !apiKey
          ? "The selected server has no API key (it may have been denied by the OS keychain). Enter it again under Settings → Connection."
          : "Check the server URL and API key under Settings → Connection.";
  return (
    <div className="flex-1 grid place-items-center text-neutral-500 text-sm p-6">
      <div className="flex flex-col items-center gap-3 max-w-md text-center">
        <Plug size={28} className="text-neutral-400" />
        <p className="font-medium text-neutral-700 dark:text-neutral-300">Not connected to a WAHA server.</p>
        <p className="text-xs">{hint}</p>
        <Button onClick={openSettings}>Open settings</Button>
        {children}
      </div>
    </div>
  );
}

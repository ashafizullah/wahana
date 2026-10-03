import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui";
import { openWelcome } from "@/screens/WelcomeScreen";
import { useWhatsApp } from "@/store/whatsapp";

export function AboutSection() {
  const native = useWhatsApp((s) => s.accounts);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);
  const linked = native.filter((a) => a.status === "working").length;
  const nativeText = native.length ? `${native.length} account${native.length === 1 ? "" : "s"} · ${linked} connected` : "No accounts";
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-neutral-500">App</dt>
        <dd className="selectable">Wahana {appVersion}</dd>
        <dt className="text-neutral-500">Accounts</dt>
        <dd className="selectable">{nativeText}</dd>
      </dl>
      <p className="text-xs text-neutral-500">
        Unofficial client, not affiliated with WhatsApp or Meta. Unofficial clients may break WhatsApp's Terms of Service and can get your
        number banned; use at your own risk.
      </p>
      <Button variant="secondary" size="sm" onClick={openWelcome}>
        Show welcome screen
      </Button>
    </>
  );
}

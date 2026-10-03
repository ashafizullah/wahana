import { useEffect, useState } from "react";
import { useServerVersion } from "@/api/queries";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui";
import { openWelcome } from "@/screens/WelcomeScreen";
import { useSettings } from "@/store/settings";
import { useWhatsApp } from "@/store/whatsapp";

export function AboutSection() {
  const { data: server, isError } = useServerVersion();
  const hasServer = useSettings((s) => !!s.client);
  const native = useWhatsApp((s) => s.accounts);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);
  const linked = native.filter((a) => a.status === "working").length;
  const serverText = server
    ? `WAHA ${server.version} · ${server.engine} · ${server.tier} · ${server.platform}`
    : !hasServer
      ? "Not configured"
      : isError
        ? "Unreachable"
        : "—";
  const nativeText = native.length
    ? `${native.length} account${native.length === 1 ? "" : "s"} · ${linked} connected · no server`
    : "No accounts";
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-neutral-500">App</dt>
        <dd className="selectable">Wahana {appVersion}</dd>
        <dt className="text-neutral-500">Native</dt>
        <dd className="selectable">{nativeText}</dd>
        <dt className="text-neutral-500">WAHA server</dt>
        <dd className="selectable">{serverText}</dd>
      </dl>
      <Button variant="secondary" size="sm" onClick={openWelcome}>
        Show welcome screen
      </Button>
    </>
  );
}

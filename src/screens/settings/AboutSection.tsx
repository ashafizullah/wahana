import { useEffect, useState } from "react";
import { useServerVersion } from "@/api/queries";
import { getVersion } from "@tauri-apps/api/app";

export function AboutSection() {
  const { data: server } = useServerVersion();
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-neutral-500">App</dt>
      <dd className="selectable">Wahana {appVersion}</dd>
      <dt className="text-neutral-500">Server</dt>
      <dd className="selectable">{server ? `WAHA ${server.version} · ${server.engine} · ${server.tier} · ${server.platform}` : "—"}</dd>
    </dl>
  );
}

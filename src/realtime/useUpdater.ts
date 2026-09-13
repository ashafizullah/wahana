import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdaterState {
  update: Update | null;
  progress: number | null; // 0..1 while downloading
  error: string | null;
  install: () => Promise<void>;
  dismiss: () => void;
}

/** Checks GitHub Releases on startup (and every 6h) for a signed update. */
export function useUpdater(): UpdaterState {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return; // dev builds have no matching release
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = async () => {
      try {
        const u = await check();
        if (u) setUpdate(u);
      } catch (e) {
        console.warn("update check failed", e);
      }
    };
    void run();
    timer = setInterval(run, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const install = async () => {
    if (!update) return;
    setError(null);
    setProgress(0);
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total) setProgress(got / total);
        } else if (ev.event === "Finished") setProgress(1);
      });
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  return { update, progress, error, install, dismiss: () => setUpdate(null) };
}

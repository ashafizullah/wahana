import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@/store/settings";

export interface CacheStats {
  bytes: number;
  files: number;
  path: string;
}

/** Cache key for a message's media: message id + extension. */
export function mediaCacheKey(messageId: string, mimetype: string) {
  const ext = (mimetype.split("/")[1] ?? "bin").split(";")[0]!.replace("jpeg", "jpg");
  return `${messageId}.${ext}`;
}

export async function cacheGet(key: string): Promise<Blob | null> {
  try {
    if (!(await invoke<boolean>("media_cache_has", { key }))) return null;
    const buf = await invoke<ArrayBuffer>("media_cache_get", { key });
    return new Blob([buf]);
  } catch {
    return null;
  }
}

export async function cachePut(key: string, blob: Blob) {
  const limitMb = useSettings.getState().cacheLimitMb;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await invoke("media_cache_put", bytes, {
    headers: { "x-key": key, "x-limit": String(Math.max(0, limitMb) * 1024 * 1024) },
  }).catch((e) => console.warn("cache put failed", e));
}

export const cacheStats = () => invoke<CacheStats>("media_cache_stats");
export const cacheClear = () => invoke<void>("media_cache_clear");

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

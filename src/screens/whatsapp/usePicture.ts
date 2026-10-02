import { useEffect, useState } from "react";
import { nativeWa } from "@/lib/nativeWa";

/** Profile picture URLs, shared by every row and header for the life of the app. */
const pictureCache = new Map<string, Promise<string | null>>();

export function usePicture(accountId: string, chatId: string, connected: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    const key = `${accountId}:${chatId}`;
    let request = pictureCache.get(key);
    if (!request) {
      request = nativeWa.picture(accountId, chatId).catch(() => {
        // Not cached on failure, so the next mount retries.
        pictureCache.delete(key);
        return null;
      });
      pictureCache.set(key, request);
    }
    let cancelled = false;
    void request.then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId, connected]);
  return url;
}

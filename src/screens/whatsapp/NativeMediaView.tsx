import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Mic, Music, Play } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Lightbox } from "@/components/Lightbox";
import { cacheGet, cachePut, formatBytes, mediaCacheKey } from "@/lib/mediaCache";
import { nativeWa, type NativeMessage } from "@/lib/nativeWa";
import { cn, errMsg } from "@/lib/utils";
import { shouldAutoLoad, useSettings } from "@/store/settings";

/**
 * Attachments of native WhatsApp messages. Bytes are downloaded and decrypted by the
 * backend on demand, then kept in the shared on-disk media cache, keyed per account so
 * two accounts never collide on a message id.
 */

const cacheKey = (accountId: string, m: NativeMessage) => mediaCacheKey(`wa_${accountId}_${m.id}`, m.media?.mimetype ?? "");

/** A message's attachment as a Blob: cache first, otherwise downloaded (and cached). */
export async function nativeMediaBlob(accountId: string, m: NativeMessage): Promise<Blob> {
  const type = m.media?.mimetype ?? "application/octet-stream";
  const key = cacheKey(accountId, m);
  const hit = await cacheGet(key);
  if (hit) return new Blob([hit], { type });
  const buf = await nativeWa.media(accountId, m.chatId, m.id);
  const blob = new Blob([buf], { type });
  void cachePut(key, blob);
  return blob;
}

/** Put just-sent bytes in the cache, so your own attachment shows without a download. */
export const cacheSentMedia = (accountId: string, m: NativeMessage, blob: Blob) => cachePut(cacheKey(accountId, m), blob);

/** Ask where to save a message's attachment, then write it there. */
export async function saveNativeMedia(accountId: string, m: NativeMessage) {
  const media = m.media!;
  const blob = await nativeMediaBlob(accountId, m);
  const ext = (media.mimetype.split("/")[1] ?? "bin").split(";")[0]!.replace("jpeg", "jpg");
  const path = await save({ defaultPath: media.fileName ?? `whatsapp-${m.id}.${ext}` });
  if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

const duration = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

export function NativeMediaView({ accountId, message: m, connected }: { accountId: string; message: NativeMessage; connected: boolean }) {
  const media = m.media!;
  const autoLoadImages = useSettings((s) => s.autoLoadImages);
  const autoLoadStickers = useSettings((s) => s.autoLoadStickers);
  const autoLoadVideos = useSettings((s) => s.autoLoadVideos);
  const autoLoadAudio = useSettings((s) => s.autoLoadAudio);
  const prefs = { autoLoadImages, autoLoadStickers, autoLoadVideos, autoLoadAudio };
  const playable = media.kind === "ptt" ? "audio" : media.kind;
  const auto = media.kind !== "document" && shouldAutoLoad(playable as "image" | "video" | "audio" | "sticker", prefs);
  const [wanted, setWanted] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Serve from the cache whenever possible; download when wanted (auto-load or click).
  useEffect(() => {
    let cancelled = false;
    let obj: string | null = null;
    const key = cacheKey(accountId, m);
    void (async () => {
      const hit = await cacheGet(key);
      if (cancelled) return;
      if (!hit && !(wanted || (auto && connected))) return;
      setLoading(true);
      setErr(null);
      try {
        const blob = hit ? new Blob([hit], { type: media.mimetype }) : await nativeMediaBlob(accountId, m);
        if (cancelled) return;
        obj = URL.createObjectURL(blob);
        setUrl(obj);
      } catch (e) {
        if (!cancelled) setErr(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, m.id, wanted, auto, connected]);

  const fetchNow = () => {
    if (!connected && !url) {
      setErr("Connect the account to download");
      return;
    }
    setWanted(true);
  };

  const saveAs = () => saveNativeMedia(accountId, m).catch((e) => setErr(errMsg(e)));

  const error = err && <div className="text-[11px] text-red-600 selectable mt-1">{err}</div>;

  // ── Documents ────────────────────────────────────────────────────────
  if (media.kind === "document") {
    return (
      <div>
        <button
          onClick={() => void saveAs()}
          className="flex items-center gap-3 rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2 min-w-[220px] max-w-[320px] text-left hover:bg-black/10 dark:hover:bg-white/15"
          title="Save file…"
        >
          <FileText size={28} className="shrink-0 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{media.fileName ?? "Document"}</div>
            <div className="text-[11px] text-neutral-500">
              {[media.size ? formatBytes(media.size) : "", (media.mimetype.split("/")[1] ?? "").toUpperCase()].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Download size={16} className="shrink-0 text-neutral-500" />
        </button>
        {error}
      </div>
    );
  }

  // ── Audio and voice notes ───────────────────────────────────────────
  if (media.kind === "audio" || media.kind === "ptt") {
    const Icon = media.kind === "ptt" ? Mic : Music;
    return (
      <div className="min-w-[240px]">
        {url ? (
          <audio src={url} controls className="w-full h-10" />
        ) : (
          <button
            onClick={fetchNow}
            className="flex items-center gap-2 rounded-full bg-black/5 dark:bg-white/10 px-3 py-1.5 text-sm hover:bg-black/10 dark:hover:bg-white/15"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            <Icon size={14} className="text-neutral-500" />
            {media.kind === "ptt" ? "Voice message" : "Audio"} {duration(media.seconds)}
          </button>
        )}
        {error}
      </div>
    );
  }

  // ── Stickers ────────────────────────────────────────────────────────
  if (media.kind === "sticker") {
    return url ? (
      <img src={url} alt="Sticker" className="w-32 h-32 object-contain" />
    ) : (
      <button
        onClick={fetchNow}
        className="w-32 h-32 grid place-items-center rounded-lg bg-black/5 dark:bg-white/10 text-xs text-neutral-500"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : "Sticker"}
      </button>
    );
  }

  // ── Images and videos ───────────────────────────────────────────────
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
  const width = Math.min(300, Math.max(160, ratio >= 1 ? 300 : 300 * ratio));
  const isVideo = media.kind === "video";
  return (
    <div>
      <div
        style={{ width, aspectRatio: String(ratio) }}
        className="relative overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-700 max-h-[360px]"
      >
        {url && isVideo ? (
          <video src={url} controls className="w-full h-full object-contain bg-black" />
        ) : url ? (
          <button onClick={() => setOpen(true)} className="block w-full h-full" title="Open">
            <img src={url} alt="" className="w-full h-full object-cover" />
          </button>
        ) : (
          <button onClick={fetchNow} className="block w-full h-full" title={isVideo ? "Play video" : "Download photo"}>
            {media.thumbnail && <img src={media.thumbnail} alt="" className="w-full h-full object-cover blur-[2px] scale-105" />}
            <span className="absolute inset-0 grid place-items-center">
              <span className={cn("rounded-full bg-black/50 text-white p-3", loading && "p-2.5")}>
                {loading ? <Loader2 size={20} className="animate-spin" /> : isVideo ? <Play size={20} /> : <Download size={20} />}
              </span>
            </span>
            {isVideo && media.seconds ? (
              <span className="absolute bottom-1.5 left-2 text-[11px] text-white drop-shadow">{duration(media.seconds)}</span>
            ) : null}
          </button>
        )}
      </div>
      {error}
      {open && url && (
        <Lightbox
          item={{
            blobUrl: url,
            kind: "image",
            filename: `whatsapp-${m.id}.${media.mimetype.includes("png") ? "png" : "jpg"}`,
            caption: m.body || undefined,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

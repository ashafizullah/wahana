import { useEffect, useState } from "react";
import { FileText, Download, Loader2, Play, Image as ImageIcon, Music, Sticker } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { mediaKind, shouldAutoLoad, useSettings } from "@/store/settings";
import { qk } from "@/api/queries";
import type { WAMessage } from "@/api/types";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/Lightbox";

interface RawMedia {
  JPEGThumbnail?: string;
  fileLength?: number | string;
  width?: number;
  height?: number;
  seconds?: number;
  fileName?: string;
}

/** Pull thumbnail / dimensions / size from the raw GOWS payload, if present. */
function rawMedia(m: WAMessage): RawMedia {
  const msg = (m._data as { Message?: Record<string, RawMedia> } | undefined)?.Message ?? {};
  const key = Object.keys(msg).find((k) => /Message$/.test(k));
  return key ? (msg[key] ?? {}) : {};
}

function formatBytes(n?: number | string) {
  const b = Number(n);
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

/**
 * Renders message media. Respects the auto-load prefs: when disabled for a
 * kind, shows a blurred thumbnail placeholder until the user clicks it.
 * Downloading = ask WAHA for the media URL (if missing) and fetch bytes with the API key.
 */
export function MediaView({ message: m, session, chatId }: { message: WAMessage; session: string; chatId: string }) {
  const client = useSettings((s) => s.client);
  const autoLoadImages = useSettings((s) => s.autoLoadImages);
  const autoLoadStickers = useSettings((s) => s.autoLoadStickers);
  const autoLoadVideos = useSettings((s) => s.autoLoadVideos);
  const autoLoadAudio = useSettings((s) => s.autoLoadAudio);
  const qc = useQueryClient();
  const mime = m.media?.mimetype ?? "";
  const kind = mediaKind(m);
  const auto = shouldAutoLoad(kind, { autoLoadImages, autoLoadStickers, autoLoadVideos, autoLoadAudio });
  const raw = rawMedia(m);

  const [wanted, setWanted] = useState(auto);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(m.media?.url ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (auto) setWanted(true);
  }, [auto]);

  useEffect(() => {
    if (!client || !wanted) return;
    let cancelled = false;
    let obj: string | null = null;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        let url = m.media?.url ?? resolvedUrl;
        if (!url) {
          const full = await client.getMessage(session, chatId, m.id, true);
          url = full.media?.url ?? null;
          if (!url) throw new Error("no media url");
          if (cancelled) return;
          setResolvedUrl(url);
          qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) =>
            old?.map((x) => (x.id === m.id ? { ...x, media: full.media } : x)),
          );
        }
        if (kind === "document") return; // documents open externally, no bytes needed
        const blob = await client.fetchMedia(url);
        if (cancelled) return;
        obj = URL.createObjectURL(blob);
        setBlobUrl(obj);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, wanted, m.id]);

  // ── Documents ────────────────────────────────────────────────────────
  if (kind === "document") {
    const name = m.media?.filename ?? raw.fileName ?? "file";
    return (
      <button
        onClick={async () => {
          let url = resolvedUrl;
          if (!url && client) {
            try {
              const full = await client.getMessage(session, chatId, m.id, true);
              url = full.media?.url ?? null;
              setResolvedUrl(url);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }
          if (url) void openUrl(url);
        }}
        className="flex items-center gap-2 rounded-lg bg-black/10 dark:bg-white/10 px-3 py-2 text-sm hover:bg-black/20 text-left"
      >
        <FileText size={18} className="shrink-0" />
        <span className="min-w-0">
          <span className="block truncate max-w-[220px]">{name}</span>
          <span className="block text-[10px] opacity-60">
            {formatBytes(raw.fileLength)} {mime && `· ${mime.split("/")[1]}`}
          </span>
        </span>
        <Download size={14} className="opacity-60 shrink-0" />
        {err && <span className="text-[10px] text-red-500">{err}</span>}
      </button>
    );
  }

  // ── Placeholder (not yet requested / loading / error) ───────────────
  if (!blobUrl) {
    const maxW = kind === "sticker" ? 140 : 320;
    const w = raw.width && raw.height ? Math.min(maxW, raw.width) : kind === "sticker" ? 140 : 240;
    const h = raw.width && raw.height ? Math.round((w * raw.height) / raw.width) : kind === "sticker" ? 140 : kind === "audio" ? 48 : 160;
    const thumb = raw.JPEGThumbnail ? `data:image/jpeg;base64,${raw.JPEGThumbnail}` : null;
    const Icon = kind === "image" ? ImageIcon : kind === "sticker" ? Sticker : kind === "video" ? Play : Music;
    return (
      <button
        onClick={() => setWanted(true)}
        disabled={loading}
        style={{ width: w, height: Math.min(h, 320) }}
        className={cn(
          "relative overflow-hidden rounded-lg bg-black/10 dark:bg-white/10 grid place-items-center",
          !loading && "cursor-pointer",
        )}
        title={err ? `Failed: ${err} — click to retry` : "Click to load"}
      >
        {thumb && (
          <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-80" />
        )}
        <span className="relative flex items-center gap-1.5 rounded-full bg-black/60 text-white px-3 py-1.5 text-xs font-medium">
          {loading ? <Loader2 size={14} className="animate-spin" /> : err ? <Download size={14} /> : <Icon size={14} />}
          {loading ? "Loading…" : err ? "Retry" : formatBytes(raw.fileLength) || "Load"}
          {!loading && !err && raw.seconds ? ` · ${Math.floor(raw.seconds / 60)}:${String(raw.seconds % 60).padStart(2, "0")}` : ""}
        </span>
      </button>
    );
  }

  // ── Loaded ───────────────────────────────────────────────────────────
  const filename =
    m.media?.filename ?? raw.fileName ?? `${m.id.split("_").pop()}.${(mime.split("/")[1] ?? "bin").replace("jpeg", "jpg")}`;
  const viewer = open && (kind === "image" || kind === "video") && (
    <Lightbox item={{ blobUrl, kind, filename, caption: m.body || undefined }} onClose={() => setOpen(false)} />
  );
  if (kind === "image") {
    return (
      <>
        <img
          src={blobUrl}
          alt=""
          onClick={() => setOpen(true)}
          className="max-w-[320px] max-h-[320px] rounded-lg object-contain cursor-zoom-in"
        />
        {viewer}
      </>
    );
  }
  if (kind === "sticker") {
    return <img src={blobUrl} alt="" className="w-[140px] h-[140px] object-contain" />;
  }
  if (kind === "video") {
    return (
      <>
        <div className="relative group">
          <video controls src={blobUrl} className="max-w-[320px] rounded-lg" />
          <button
            onClick={() => setOpen(true)}
            className="absolute top-1.5 right-1.5 rounded bg-black/60 text-white px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition"
          >
            Fullscreen
          </button>
        </div>
        {viewer}
      </>
    );
  }
  return <audio controls src={blobUrl} className="max-w-[280px]" />;
}

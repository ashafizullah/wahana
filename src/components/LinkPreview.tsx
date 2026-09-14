import { useEffect, useState } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Globe } from "lucide-react";
import type { WAMessage } from "@/api/types";
import { useSettings } from "@/store/settings";

export interface Preview {
  url: string;
  title?: string;
  description?: string;
  /** data: or blob: URL of the thumbnail */
  image?: string | null;
}

interface ExtText {
  text?: string;
  matchedText?: string;
  canonicalURL?: string;
  title?: string;
  description?: string;
  JPEGThumbnail?: string;
}

/** Preview data WhatsApp embedded in the message (sender generated it). */
export function embeddedPreview(m: WAMessage): Preview | null {
  const ext = (m._data as { Message?: { extendedTextMessage?: ExtText } } | undefined)?.Message?.extendedTextMessage;
  if (!ext) return null;
  const url = ext.canonicalURL || ext.matchedText;
  if (!url || (!ext.title && !ext.description && !ext.JPEGThumbnail)) return null;
  return {
    url,
    title: ext.title,
    description: ext.description,
    image: ext.JPEGThumbnail ? `data:image/jpeg;base64,${ext.JPEGThumbnail}` : null,
  };
}

export function firstUrl(text: string | undefined) {
  const m = text?.match(/https?:\/\/[^\s<>]+/);
  return m ? m[0].replace(/[.,;:!?)\]]+$/, "") : null;
}

/** Only web links may be fetched or opened: message data can carry any scheme (file:, javascript:, custom app URLs). */
export function isWebUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Hosts we never auto-fetch: a sender could otherwise probe this machine's LAN / localhost services through the app. */
function isPrivateHost(url: string) {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

// ── Fallback: fetch Open Graph tags ourselves ────────────────────────────
const MAX_CACHE = 200;
const cache = new Map<string, Promise<Preview | null>>();
/** Insert as most-recent; evict the oldest entry (and its thumbnail object URL) past the cap. */
function remember(url: string, p: Promise<Preview | null>) {
  cache.delete(url);
  cache.set(url, p);
  if (cache.size > MAX_CACHE) {
    const [oldest, old] = cache.entries().next().value as [string, Promise<Preview | null>];
    cache.delete(oldest);
    void old.then((v) => v?.image?.startsWith("blob:") && URL.revokeObjectURL(v.image));
  }
}

function meta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i");
  const v = html.match(re)?.[1] ?? html.match(re2)?.[1];
  return v ? decode(v) : undefined;
}
function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function fetchPreview(url: string): Promise<Preview | null> {
  if (!isWebUrl(url) || isPrivateHost(url)) return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await tauriFetch(url, {
          headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; Wahana/1.0; +link-preview)" },
          signal: ctrl.signal,
          maxRedirections: 5,
        });
        clearTimeout(t);
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
        const html = (await res.text()).slice(0, 300_000);
        const title = meta(html, "og:title") ?? meta(html, "twitter:title") ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
        const description = meta(html, "og:description") ?? meta(html, "twitter:description") ?? meta(html, "description");
        let image: string | null = null;
        const img = meta(html, "og:image") ?? meta(html, "twitter:image");
        if (img) {
          try {
            const abs = new URL(img, url).toString();
            if (!isWebUrl(abs) || isPrivateHost(abs)) throw new Error("skip");
            const ir = await tauriFetch(abs, { maxRedirections: 5 });
            if (ir.ok) image = URL.createObjectURL(await ir.blob());
          } catch {
            /* no image */
          }
        }
        if (!title && !description && !image) return null;
        return { url, title: title || undefined, description, image };
      } catch {
        return null;
      }
    })();
    remember(url, p);
  }
  return p;
}

export function LinkPreviewCard({ message: m }: { message: WAMessage }) {
  const fetchEnabled = useSettings((s) => s.linkPreviews);
  const embedded = embeddedPreview(m);
  const url = embedded?.url ?? firstUrl(m.body);
  const [preview, setPreview] = useState<Preview | null>(embedded);

  useEffect(() => {
    if (embedded || !url || !fetchEnabled) return;
    let alive = true;
    void fetchPreview(url).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [embedded, url, fetchEnabled]);

  if (!preview || !url || !isWebUrl(preview.url)) return null;
  let host = "";
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  return (
    <button
      onClick={() => openUrl(preview.url)}
      className="mt-1 w-full max-w-[340px] flex items-stretch gap-2 rounded-lg overflow-hidden bg-black/5 dark:bg-white/10 text-left hover:bg-black/10 dark:hover:bg-white/15"
      title={preview.url}
    >
      {preview.image ? (
        <img src={preview.image} alt="" className="w-20 shrink-0 object-cover" />
      ) : (
        <div className="w-14 shrink-0 grid place-items-center text-neutral-400"><Globe size={18} /></div>
      )}
      <div className="min-w-0 py-1.5 pr-2">
        {preview.title && <div className="text-xs font-semibold line-clamp-2 break-words">{preview.title}</div>}
        {preview.description && <div className="text-[11px] opacity-70 line-clamp-2 break-words">{preview.description}</div>}
        <div className="text-[10px] opacity-60 truncate">{host}</div>
      </div>
    </button>
  );
}

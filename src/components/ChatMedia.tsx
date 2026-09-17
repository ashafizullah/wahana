import { useEffect, useMemo, useState } from "react";
import { FileText, Link as LinkIcon, Loader2, Play, Image as ImageIcon, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requireClient, useSettings, mediaKind } from "@/store/settings";
import { usePushNames } from "@/store/pushNames";
import { loadMessageMedia } from "@/lib/mediaCache";
import { embeddedPreview, firstUrl } from "@/components/LinkPreview";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Button } from "@/components/ui";
import { cn, formatTime } from "@/lib/utils";
import type { WAMessage } from "@/api/types";

const PAGE = 200;

/** Pages through a chat's history (no media download) so we can list media / links / documents. */
function useChatScan(session: string, chatId: string) {
  const client = useSettings((s) => s.client);
  const [messages, setMessages] = useState<WAMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (before?: number) => {
    if (!client || loading) return;
    setLoading(true);
    try {
      const page = await client.messages(session, chatId, { limit: PAGE, before, downloadMedia: false });
      usePushNames.getState().learn(page);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...page.filter((m) => !ids.has(m.id))];
      });
      if (page.length < PAGE) setDone(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    setDone(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, chatId, client]);

  const oldest = messages[messages.length - 1]?.timestamp;
  return { messages, loading, done, loadMore: () => oldest && load(oldest - 1) };
}

type Tab = "media" | "links" | "docs";

export function ChatMedia({ session, chatId }: { session: string; chatId: string }) {
  const [tab, setTab] = useState<Tab>("media");
  const { messages, loading, done, loadMore } = useChatScan(session, chatId);

  const buckets = useMemo(() => {
    const media: WAMessage[] = [];
    const docs: WAMessage[] = [];
    const links: { m: WAMessage; url: string; title?: string; thumb?: string | null }[] = [];
    for (const m of messages) {
      if (m.hasMedia) {
        const k = mediaKind(m);
        if (k === "image" || k === "video") media.push(m);
        else if (k === "document") docs.push(m);
        continue;
      }
      const url = firstUrl(m.body);
      if (url) {
        const p = embeddedPreview(m);
        links.push({ m, url, title: p?.title, thumb: p?.image });
      }
    }
    return { media, docs, links };
  }, [messages]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex gap-1 px-4 pt-3 pb-2">
        {(["media", "links", "docs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              tab === t ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
            )}
          >
            {t === "media"
              ? `Media ${buckets.media.length}`
              : t === "links"
                ? `Links ${buckets.links.length}`
                : `Docs ${buckets.docs.length}`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {tab === "media" && <MediaGrid session={session} chatId={chatId} items={buckets.media} />}
        {tab === "links" && <LinkList items={buckets.links} />}
        {tab === "docs" && <DocList session={session} chatId={chatId} items={buckets.docs} />}
        <div className="pt-3 text-center">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-neutral-400 inline" />
          ) : done ? (
            <span className="text-[11px] text-neutral-400">Scanned {messages.length} messages · whole history</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={loadMore}>
              Scan older ({messages.length} so far)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function rawOf(m: WAMessage) {
  const msg =
    (
      m._data as
        | {
            Message?: Record<
              string,
              { JPEGThumbnail?: string; fileName?: string; fileLength?: number | string; seconds?: number; title?: string }
            >;
          }
        | undefined
    )?.Message ?? {};
  const k = Object.keys(msg).find((x) => /Message$/.test(x));
  return k ? (msg[k] ?? {}) : {};
}

function MediaGrid({ session, chatId, items }: { session: string; chatId: string; items: WAMessage[] }) {
  const client = useSettings((s) => s.client);
  const [open, setOpen] = useState<LightboxItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const view = async (m: WAMessage) => {
    if (!client) return;
    setBusy(m.id);
    try {
      const { blob, mimetype } = await loadMessageMedia(client, session, chatId, m);
      const kind = mimetype.startsWith("video/") ? "video" : "image";
      setOpen({
        blobUrl: URL.createObjectURL(blob),
        kind,
        filename: `${m.id.split("_").pop()}.${mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "bin"}`,
        caption: m.body || undefined,
      });
    } catch (e) {
      console.warn(e);
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No photos or videos yet.</p>;
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => {
          const raw = rawOf(m);
          const thumb = raw.JPEGThumbnail ? `data:image/jpeg;base64,${raw.JPEGThumbnail}` : null;
          const video = mediaKind(m) === "video";
          return (
            <button
              key={m.id}
              onClick={() => view(m)}
              className="relative aspect-square rounded-md overflow-hidden bg-neutral-200 dark:bg-neutral-800 grid place-items-center"
              title={formatTime(m.timestamp)}
            >
              {thumb ? (
                <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <ImageIcon size={18} className="text-neutral-400" />
              )}
              {video && <Play size={18} className="relative text-white drop-shadow" />}
              {busy === m.id && <Loader2 size={18} className="relative text-white animate-spin" />}
            </button>
          );
        })}
      </div>
      {open && (
        <Lightbox
          item={open}
          onClose={() => {
            URL.revokeObjectURL(open.blobUrl);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function LinkList({ items }: { items: { m: WAMessage; url: string; title?: string; thumb?: string | null }[] }) {
  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No links yet.</p>;
  return (
    <ul className="space-y-1">
      {items.map(({ m, url, title, thumb }) => {
        let host = url;
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        return (
          <li key={m.id}>
            <button
              onClick={() => openUrl(url)}
              className="w-full flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {thumb ? (
                <img src={thumb} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
                  <Globe size={16} className="text-neutral-400" />
                </div>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium truncate">{title || url}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  <LinkIcon size={10} className="inline mr-1" />
                  {host} · {formatTime(m.timestamp)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DocList({ session, chatId, items }: { session: string; chatId: string; items: WAMessage[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (m: WAMessage) => {
    setBusy(m.id);
    try {
      let url = m.media?.url ?? null;
      if (!url) url = (await requireClient().getMessage(session, chatId, m.id, true)).media?.url ?? null;
      if (url) void openUrl(url);
    } finally {
      setBusy(null);
    }
  };
  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No documents yet.</p>;
  return (
    <ul className="space-y-1">
      {items.map((m) => {
        const raw = rawOf(m);
        const name = m.media?.filename ?? raw.fileName ?? "file";
        const size = Number(raw.fileLength) || 0;
        return (
          <li key={m.id}>
            <button
              onClick={() => open(m)}
              className="w-full flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <div className="w-10 h-10 rounded bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
                {busy === m.id ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} className="text-neutral-500" />}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium truncate">{name}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  {size ? `${size < 1024 ** 2 ? (size / 1024).toFixed(0) + " KB" : (size / 1024 ** 2).toFixed(1) + " MB"} · ` : ""}
                  {formatTime(m.timestamp)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

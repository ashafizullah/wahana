import { useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@/components/Confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X, Type, Image as ImageIcon, RefreshCw, Pause, Play, CheckCheck, Search } from "lucide-react";
import { useStatusSeen } from "@/store/statusSeen";
import { requireClient, useSettings } from "@/store/settings";
import { useNameResolver } from "@/realtime/useNames";
import { usePushNames } from "@/store/pushNames";
import { loadMessageMedia } from "@/lib/mediaCache";
import { WaMarkdown } from "@/lib/waMarkdown";
import { Avatar, Button, Input } from "@/components/ui";
import { cn, displayId, fileToBase64, formatTime } from "@/lib/utils";
import type { WAMessage } from "@/api/types";
import { NotConnected } from "@/components/NotConnected";

const STATUS_CHAT = "status@broadcast";

interface Story {
  m: WAMessage;
  kind: "image" | "video" | "text";
  thumb: string | null;
  text: string;
  bg?: string;
}

function toStory(m: WAMessage): Story {
  const msg = (m._data as { Message?: Record<string, { JPEGThumbnail?: string; caption?: string; text?: string; backgroundArgb?: number }> } | undefined)?.Message ?? {};
  const k = Object.keys(msg).find((x) => x !== "messageContextInfo") ?? "";
  const inner = msg[k] ?? {};
  const kind = k === "videoMessage" ? "video" : k === "imageMessage" ? "image" : "text";
  const argb = inner.backgroundArgb;
  const bg = argb ? `#${(argb & 0xffffff).toString(16).padStart(6, "0")}` : undefined;
  return { m, kind, thumb: inner.JPEGThumbnail ? `data:image/jpeg;base64,${inner.JPEGThumbnail}` : null, text: m.body || inner.caption || inner.text || "", bg };
}

/** Status (stories) from contacts in the last 24h, plus posting your own. */
export function StatusScreen() {
  const { session, client } = useSettings();
  const qc = useQueryClient();
  const resolveName = useNameResolver(session, STATUS_CHAT);
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const seen = useStatusSeen((s) => s.seen);
  const hydrateSeen = useStatusSeen((s) => s.hydrate);
  const [search, setSearch] = useState("");
  useEffect(() => {
    void hydrateSeen();
  }, [hydrateSeen]);

  const q = useQuery({
    queryKey: ["status", session],
    queryFn: async () => {
      const list = await requireClient().statusMessages(session);
      usePushNames.getState().learn(list);
      return list;
    },
    enabled: !!client && !!session,
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => {
    const now = Date.now() / 1000;
    const by = new Map<string, Story[]>();
    for (const m of q.data ?? []) {
      if (now - m.timestamp > 86_400) continue;
      const key = m.fromMe ? "me" : m.participant || m.from;
      (by.get(key) ?? by.set(key, []).get(key)!).push(toStory(m));
    }
    const term = search.trim().toLowerCase().replace(/^\+/, "");
    return [...by.entries()]
      .map(([id, stories]) => {
        const sorted = stories.sort((a, b) => a.m.timestamp - b.m.timestamp);
        const name = id === "me" ? "My status" : resolveName(id) ?? displayId(id);
        const unseen = id === "me" ? 0 : sorted.filter((st) => !seen[st.m.id]).length;
        return { id, stories: sorted, name, unseen, latest: sorted[sorted.length - 1]!.m.timestamp };
      })
      .filter((g) => !term || g.name.toLowerCase().includes(term) || g.id.replace(/\D/g, "").includes(term.replace(/\D/g, "") || "\u0000"))
      .sort((a, b) => {
        if (a.id === "me") return -1;
        if (b.id === "me") return 1;
        // Contacts with unseen updates first, fully-viewed ones sink to the bottom; newest first within each group.
        if (!!a.unseen !== !!b.unseen) return a.unseen ? -1 : 1;
        return b.latest - a.latest;
      });
  }, [q.data, seen, resolveName, search]);

  const current = groups.find((g) => g.id === selected) ?? null;

  if (!client) return <NotConnected />;

  return (
    <>
      <div className="w-80 shrink-0 flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800">
          <div className="h-14 flex items-center gap-2 px-4">
            <span className="font-semibold flex-1 flex items-center gap-2">Status <span className="text-[10px] rounded-full bg-wa/15 text-wa-dark dark:text-wa px-1.5 py-0.5 font-mono font-normal" title="Session — switch it in Chats">{session}</span></span>
            <Button size="sm" variant="ghost" onClick={() => q.refetch()} title="Refresh"><RefreshCw size={14} className={cn(q.isFetching && "animate-spin")} /></Button>
            <Button size="sm" onClick={() => setCompose(true)} title="Post a status"><Plus size={14} /></Button>
          </div>
          <div className="relative px-3 pb-3">
            <Search size={14} className="absolute left-5.5 top-2.5 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearch("")}
              placeholder="Search by name or number"
              className="w-full rounded-lg bg-neutral-100 dark:bg-neutral-800 pl-8 pr-3 py-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {q.isLoading && <Loader2 className="animate-spin text-neutral-400 m-4" />}
          {q.error && <div className="p-4 text-xs text-red-600 selectable">{(q.error as Error).message}</div>}
          {!q.isLoading && groups.length === 0 && <p className="p-4 text-sm text-neutral-500">No status updates in the last 24 hours.</p>}
          {groups.map((g, i) => {
            const last = g.stories[g.stories.length - 1]!;
            const { name, unseen } = g;
            const firstViewed = g.id !== "me" && !unseen && (i === 0 || groups[i - 1]!.id === "me" || !!groups[i - 1]!.unseen);
            return (
              <div key={g.id}>
              {firstViewed && <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Viewed</div>}
              <button
                onClick={() => setSelected(g.id)}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800", selected === g.id && "bg-neutral-100 dark:bg-neutral-800")}
              >
                <div className="relative">
                  <div className={cn("rounded-full p-[2px] ring-2", unseen ? "ring-wa" : "ring-neutral-300 dark:ring-neutral-600")}>
                    <Avatar src={last.thumb} name={name} size={40} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{name}</div>
                  <div className={cn("text-xs", unseen ? "text-neutral-800 dark:text-neutral-100 font-medium" : "text-neutral-500")}>
                    {unseen ? `${unseen} new · ` : ""}{g.stories.length} update{g.stories.length === 1 ? "" : "s"} · {formatTime(last.m.timestamp)}
                  </div>
                </div>
              </button>
              </div>
            );
          })}
          {!q.isLoading && groups.length === 0 && search && <p className="p-4 text-sm text-neutral-500">No status matches “{search}”.</p>}
        </div>
      </div>
      {current ? (
        <StoryViewer
          key={current.id}
          session={session}
          name={current.name}
          stories={current.stories}
          mine={current.id === "me"}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["status", session] })}
          onNextContact={(() => {
            const i = groups.findIndex((g) => g.id === current.id);
            const next = groups[i + 1];
            return next ? () => setSelected(next.id) : undefined;
          })()}
          onPrevContact={(() => {
            const i = groups.findIndex((g) => g.id === current.id);
            const prev = groups[i - 1];
            return prev ? () => setSelected(prev.id) : undefined;
          })()}
        />
      ) : (
        <div className="flex-1 grid place-items-center text-neutral-500 text-sm">Select a contact to view their status</div>
      )}
      {compose && <ComposeStatus session={session} onClose={() => setCompose(false)} onPosted={() => { setCompose(false); setTimeout(() => q.refetch(), 1500); }} />}
    </>
  );
}

const IMAGE_SECONDS = 6;

function StoryViewer({
  session,
  name,
  stories,
  mine,
  onDeleted,
  onNextContact,
  onPrevContact,
}: {
  session: string;
  name: string;
  stories: Story[];
  mine: boolean;
  onDeleted: () => void;
  /** Called when the last story of this contact finishes / is skipped past; undefined = last contact. */
  onNextContact?: () => void;
  onPrevContact?: () => void;
}) {
  const client = useSettings((s) => s.client);
  const seen = useStatusSeen((s) => s.seen);
  const mark = useStatusSeen((s) => s.mark);
  const readMode = useSettings((s) => s.readReceipts);
  const [reported, setReported] = useState<Record<string, boolean>>({}); // story id → receipt sent (manual mode)
  // Start at the oldest unseen update; if everything was seen, replay from the beginning.
  const [i, setI] = useState(() => {
    const idx = stories.findIndex((st) => !seen[st.m.id]);
    return idx === -1 ? 0 : idx;
  });
  const [blob, setBlob] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 for the current item
  const videoRef = useRef<HTMLVideoElement>(null);
  const story = stories[Math.min(i, stories.length - 1)]!;

  const reportView = (st: Story) => {
    const participant = st.m.participant || st.m.from;
    return requireClient()
      .sendSeen(session, STATUS_CHAT, [st.m.id], participant)
      .then(() => setReported((r) => ({ ...r, [st.m.id]: true })))
      .catch(() => {});
  };

  // Mark as viewed locally; tell WhatsApp (the sender sees you in "viewed by") unless the tweak says manual/never.
  useEffect(() => {
    if (mine || seen[story.m.id]) return;
    mark(story.m.id);
    if (readMode === "always" || readMode === "on-reply") void reportView(story);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.m.id]);

  // Auto-advance: images/text after a fixed time, videos when they end.
  const ready = story.kind === "text" || !!blob;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, blob]);
  useEffect(() => {
    setProgress(0);
    if (!ready || paused || story.kind === "video") return;
    const started = Date.now();
    const t = setInterval(() => {
      const p = (Date.now() - started) / (IMAGE_SECONDS * 1000);
      if (p >= 1) {
        clearInterval(t);
        if (i < stories.length - 1) setI(i + 1);
        else if (onNextContact) onNextContact();
        else setPaused(true);
      } else setProgress(p);
    }, 50);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, paused, story.m.id]);

  useEffect(() => {
    if (!client || story.kind === "text") {
      setBlob(null);
      return;
    }
    let alive = true;
    let obj: string | null = null;
    setLoading(true);
    setErr(null);
    setBlob(null);
    loadMessageMedia(client, session, STATUS_CHAT, story.m)
      .then(({ blob }) => {
        if (!alive) return;
        obj = URL.createObjectURL(blob);
        setBlob(obj);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [client, session, story]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { if (i > 0) setI(i - 1); else onPrevContact?.(); setPaused(false); }
      if (e.key === "ArrowRight") { if (i < stories.length - 1) setI(i + 1); else onNextContact?.(); setPaused(false); }
      if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stories.length, i, onNextContact, onPrevContact]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-neutral-950 text-white" onClick={(e) => { if ((e.target as HTMLElement).closest("button,video,a")) return; setPaused((p) => !p); }}>
      <div className="flex gap-1 px-4 pt-3">
        {stories.map((s, j) => (
          <button key={s.m.id} onClick={() => { setI(j); setPaused(false); }} className="h-1 flex-1 rounded-full bg-white/30 overflow-hidden">
            <div className="h-full bg-white" style={{ width: j < i ? "100%" : j === i ? `${Math.round(progress * 100)}%` : "0%" }} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-white/60">{new Date(story.m.timestamp * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {i + 1}/{stories.length}</div>
        </div>
        {!mine && readMode === "manual" && (
          <button
            onClick={() => reportView(story)}
            disabled={!!reported[story.m.id]}
            className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs", reported[story.m.id] ? "text-sky-400" : "bg-wa text-wa-teal hover:bg-wa/90")}
            title={reported[story.m.id] ? "Marked as viewed" : "Let the sender know you viewed this status"}
          >
            <CheckCheck size={14} /> {reported[story.m.id] ? "Viewed" : "Mark viewed"}
          </button>
        )}
        <button onClick={() => setPaused((p) => !p)} className="text-white/70 hover:text-white" title={paused ? "Play" : "Pause"}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        {mine && (
          <button
            disabled={busy}
            title="Delete this status"
            className="text-white/70 hover:text-red-400"
            onClick={async () => {
              if (!(await confirm({ title: "Delete this status update?", danger: true, confirmLabel: "Confirm" }))) return;
              setBusy(true);
              try {
                await requireClient().deleteStatus(session, story.m.id.split("_")[2] ?? story.m.id);
                onDeleted();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        )}
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <button onClick={() => { if (i > 0) setI(i - 1); else onPrevContact?.(); setPaused(false); }} disabled={i === 0 && !onPrevContact} className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20" title={i === 0 ? "Previous contact" : "Previous"}><ChevronLeft /></button>
        <button onClick={() => { if (i < stories.length - 1) setI(i + 1); else onNextContact?.(); setPaused(false); }} disabled={i >= stories.length - 1 && !onNextContact} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20" title={i >= stories.length - 1 ? "Next contact" : "Next"}><ChevronRight /></button>
        {story.kind === "text" ? (
          <div className="h-full max-h-full aspect-[9/16] max-w-full rounded-2xl flex items-center justify-center p-8 text-center text-2xl font-medium" style={{ background: story.bg ?? "#128c7e" }}>
            <WaMarkdown text={story.text} />
          </div>
        ) : loading ? (
          <div className="relative h-full max-h-full flex items-center justify-center">
            {story.thumb && <img src={story.thumb} alt="" className="max-h-full max-w-full object-contain rounded-xl blur-md opacity-60" />}
            <Loader2 className="absolute animate-spin" />
          </div>
        ) : err ? (
          <div className="text-sm text-red-300 selectable">{err}</div>
        ) : blob ? (
          story.kind === "video" ? (
            <video
              ref={videoRef}
              src={blob}
              autoPlay
              controls
              className="max-h-full max-w-full object-contain rounded-xl"
              onTimeUpdate={(e) => e.currentTarget.duration && setProgress(e.currentTarget.currentTime / e.currentTarget.duration)}
              onEnded={() => (i < stories.length - 1 ? setI(i + 1) : onNextContact ? onNextContact() : setPaused(true))}
            />
          ) : (
            <img src={blob} alt="" className="max-h-full max-w-full object-contain rounded-xl" />
          )
        ) : null}
      </div>
      {story.kind !== "text" && story.text && (
        <div className="px-6 py-3 text-center text-sm bg-black/40 selectable"><WaMarkdown text={story.text} /></div>
      )}
    </div>
  );
}

const COLORS = ["#128c7e", "#075e54", "#25d366", "#ff5722", "#e91e63", "#9c27b0", "#3f51b5", "#2196f3", "#607d8b", "#000000"];

function ComposeStatus({ session, onClose, onPosted }: { session: string; onClose: () => void; onPosted: () => void }) {
  const [mode, setMode] = useState<"text" | "media">("text");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(COLORS[0]!);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const post = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = requireClient();
      if (mode === "text") await c.postTextStatus(session, text.trim(), bg);
      else if (file) {
        const payload = { mimetype: file.type, filename: file.name, data: await fileToBase64(file) };
        if (file.type.startsWith("video/")) await c.postVideoStatus(session, payload, caption.trim() || undefined);
        else await c.postImageStatus(session, payload, caption.trim() || undefined);
      }
      onPosted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[420px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <span className="font-semibold flex-1">New status <span className="text-xs font-normal text-neutral-500">· posted from {session}</span></span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-1">
            <Button size="sm" variant={mode === "text" ? "primary" : "secondary"} onClick={() => setMode("text")}><Type size={12} /> Text</Button>
            <Button size="sm" variant={mode === "media" ? "primary" : "secondary"} onClick={() => setMode("media")}><ImageIcon size={12} /> Photo / video</Button>
          </div>
          {mode === "text" ? (
            <>
              <div className="rounded-xl p-6 min-h-40 grid place-items-center text-white text-center" style={{ background: bg }}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type a status"
                  rows={3}
                  autoFocus
                  className="w-full bg-transparent text-center text-lg font-medium placeholder-white/60 outline-none resize-none"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setBg(c)} className={cn("w-6 h-6 rounded-full border-2", bg === c ? "border-neutral-900 dark:border-white" : "border-transparent")} style={{ background: c }} />
                ))}
              </div>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileRef.current?.click()} className="w-full rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 min-h-40 grid place-items-center overflow-hidden">
                {preview ? (
                  file!.type.startsWith("video/") ? <video src={preview} className="max-h-60" /> : <img src={preview} alt="" className="max-h-60 object-contain" />
                ) : (
                  <span className="text-sm text-neutral-500">Choose a photo or video</span>
                )}
              </button>
              <Input placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
            </>
          )}
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || (mode === "text" ? !text.trim() : !file)} onClick={post}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Post"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

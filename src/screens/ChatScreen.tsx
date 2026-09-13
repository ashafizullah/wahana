import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search, Send, Check, CheckCheck, Clock, X, Users, Megaphone, SquarePen, Info, CalendarDays, ArrowDown } from "lucide-react";
import { useChats, useMessages, useSendText, useSessions, useMediaPrefixes, qk } from "@/api/queries";
import { mediaKind, requireClient, useSettings } from "@/store/settings";
import { Avatar, Button } from "@/components/ui";
import { MediaView } from "@/components/MediaView";
import { MessageMenu, type MenuPos } from "@/components/MessageMenu";
import { AttachMenu, VoiceRecorder, LocationDialog, ContactDialog, PollDialog, type AttachKind } from "@/components/AttachMenu";
import { NewChatDialog } from "@/components/NewChatDialog";
import { InfoPanel } from "@/components/InfoPanel";
import { usePresence, presenceLabel } from "@/realtime/usePresence";
import { useNameResolver } from "@/realtime/useNames";
import { QuoteView, type ReplyTo } from "@/components/QuoteView";
import { ResizeHandle, usePaneWidth } from "@/components/ResizeHandle";
import { LinkPreviewCard } from "@/components/LinkPreview";
import { bareId, summarize, useReactions } from "@/store/reactions";
import type { MentionResolver } from "@/lib/waMarkdown";
import { WaMarkdown, stripWaMarkdown } from "@/lib/waMarkdown";
import type { ChatOverview, WAMessage } from "@/api/types";
import { cn, displayId, fileToBase64, formatDateDivider, formatTime, isChannel, isGroup } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chatKey, unreadFor, useUnread } from "@/store/unread";
import { usePushNames } from "@/store/pushNames";

export function ChatScreen({ onNeedSetup }: { onNeedSetup: () => void }) {
  const { client, session } = useSettings();
  const { data: sessions } = useSessions();
  const [selected, setSelected] = useState<string | null>(null);
  const [listWidth, setListWidth] = usePaneWidth("chatList", 320, 240, 560);

  const sessionInfo = sessions?.find((s) => s.name === session);

  if (!client) {
    return (
      <Empty>
        <p>Not connected.</p>
        <Button onClick={onNeedSetup}>Open settings</Button>
      </Empty>
    );
  }
  if (sessions && !sessionInfo) {
    return <Empty>Session “{session}” not found on server. Pick one in Sessions.</Empty>;
  }
  if (sessionInfo && sessionInfo.status !== "WORKING") {
    return <Empty>Session “{session}” is {sessionInfo.status}. Start / log in from Sessions.</Empty>;
  }

  return (
    <>
      <ChatList session={session} selected={selected} onSelect={setSelected} width={listWidth} />
      <ResizeHandle onDrag={(dx) => setListWidth((w) => w + dx)} onReset={() => setListWidth(320)} />
      {selected ? (
        <Conversation key={selected} session={session} chatId={selected} />
      ) : (
        <Empty>Select a chat</Empty>
      )}
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center text-neutral-500 text-sm">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

// ── Chat list ────────────────────────────────────────────────────────────

function ChatList({
  session,
  selected,
  onSelect,
  width,
}: {
  session: string;
  selected: string | null;
  onSelect: (id: string) => void;
  width: number;
}) {
  const { data, isLoading, error } = useChats(session);
  const { data: sessions } = useSessions();
  const save = useSettings((s) => s.save);
  const [q, setQ] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  const counts = useUnread((s) => s.counts);
  const lastSeen = useUnread((s) => s.lastSeen);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("wahana:focus-search", focus);
    return () => window.removeEventListener("wahana:focus-search", focus);
  }, []);

  const chats = useMemo(() => {
    let list = (data ?? []).filter((c) => c.id !== "status@broadcast");
    if (filter === "groups") list = list.filter((c) => isGroup(c.id));
    if (filter === "unread") list = list.filter((c) => unreadFor({ counts, lastSeen }, session, c.id, c.lastMessage) > 0);
    const term = q.trim().toLowerCase();
    return term
      ? list.filter((c) => (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term))
      : list;
  }, [data, q, filter, counts, lastSeen, session]);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <div style={{ width }} className="shrink-0 flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        <ProfilePicker />
        <SessionPicker
          sessions={sessions ?? []}
          value={session}
          onChange={(name) => save({ session: name })}
        />
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQ("");
                if (e.key === "Enter" && chats[0]) onSelect(chats[0].id);
              }}
              placeholder="Search chats (⌘K)"
              className="w-full rounded-lg bg-neutral-100 dark:bg-neutral-800 pl-8 pr-3 py-1.5 text-sm outline-none"
            />
          </div>
          <Button variant="ghost" size="sm" title="New chat" onClick={() => setNewChat(true)}>
            <SquarePen size={16} />
          </Button>
        </div>
        <div className="flex gap-1.5">
          {(["all", "unread", "groups"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize",
                filter === f ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {newChat && <NewChatDialog session={session} onPick={onSelect} onClose={() => setNewChat(false)} />}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-neutral-400">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {error && <div className="p-4 text-sm text-red-600 selectable">{String((error as Error).message)}</div>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const c = chats[v.index]!;
            return (
              <div
                key={c.id}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
              >
                <ChatRow chat={c} session={session} active={c.id === selected} onClick={() => onSelect(c.id)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProfilePicker() {
  const profiles = useSettings((s) => s.profiles);
  const active = useSettings((s) => s.activeProfile);
  const switchProfile = useSettings((s) => s.switchProfile);
  const qc = useQueryClient();
  if (profiles.length < 2) return null;
  return (
    <select
      value={active}
      onChange={async (e) => {
        await switchProfile(e.target.value);
        qc.clear();
      }}
      className="w-full rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-xs outline-none cursor-pointer"
      title="Server"
    >
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: { name: string; status: string; me?: { pushName?: string } | null }[];
  value: string;
  onChange: (name: string) => void;
}) {
  const dot = (status: string) =>
    status === "WORKING" ? "bg-emerald-500" : status === "STOPPED" ? "bg-neutral-400" : "bg-amber-400";
  const current = sessions.find((s) => s.name === value);
  return (
    <label className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-sm">
      <span className={cn("w-2 h-2 rounded-full shrink-0", dot(current?.status ?? ""))} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent outline-none cursor-pointer min-w-0 truncate"
        title="Active session"
      >
        {!current && <option value={value}>{value} (not found)</option>}
        {sessions.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
            {s.me?.pushName ? ` · ${s.me.pushName}` : ""} · {s.status}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Short label for body-less messages (media, polls, contacts, locations…). */
function previewKind(m: WAMessage) {
  const msg = (m._data as { Message?: Record<string, unknown> } | undefined)?.Message ?? {};
  if (m.location) return "📍 Location";
  if (m.vCards?.length) return "👤 Contact";
  if (Object.keys(msg).some((k) => k.startsWith("pollCreation"))) return "📊 Poll";
  if (msg.stickerMessage) return "🎟️ Sticker";
  if (msg.audioMessage) return "🎤 Voice message";
  if (msg.videoMessage) return "🎬 Video";
  if (msg.imageMessage) return "📷 Photo";
  if (msg.documentMessage) return "📄 Document";
  if (m.hasMedia) return "📎 Media";
  return "";
}

function ChatRow({
  chat,
  session,
  active,
  onClick,
}: {
  chat: ChatOverview;
  session: string;
  active: boolean;
  onClick: () => void;
}) {
  const name = chat.name || displayId(chat.id);
  const lm = chat.lastMessage;
  const counts = useUnread((s) => s.counts);
  const lastSeen = useUnread((s) => s.lastSeen);
  const unread = unreadFor({ counts, lastSeen }, session, chat.id, lm);
  const preview = lm ? (lm.body ? stripWaMarkdown(lm.body) : previewKind(lm)) : "";
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        active && "bg-neutral-100 dark:bg-neutral-800",
      )}
    >
      <Avatar src={chat.picture} name={name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {isGroup(chat.id) && <Users size={12} className="text-neutral-400 shrink-0" />}
          {isChannel(chat.id) && <Megaphone size={12} className="text-neutral-400 shrink-0" />}
          <span className="font-medium truncate">{name}</span>
          {lm && <span className="ml-auto text-[11px] text-neutral-400 shrink-0">{formatTime(lm.timestamp)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("text-xs truncate flex-1", unread ? "text-neutral-800 dark:text-neutral-100 font-medium" : "text-neutral-500")}>
            {lm?.fromMe && <AckIcon ack={lm.ack} className="inline mr-1 -mt-0.5" />}
            {preview}
          </div>
          {unread > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-wa text-[10px] font-bold text-white grid place-items-center">
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Conversation ─────────────────────────────────────────────────────────

function Conversation({ session, chatId }: { session: string; chatId: string }) {
  const { data: chats } = useChats(session);
  const chat = chats?.find((c) => c.id === chatId);
  const name = chat?.name || displayId(chatId);
  const { data: messages, isLoading, error } = useMessages(session, chatId);
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<WAMessage | null>(null);
  const [editing, setEditing] = useState<WAMessage | null>(null);
  const [menu, setMenu] = useState<{ m: WAMessage; pos: MenuPos } | null>(null);
  const [info, setInfo] = useState(false);
  const [search, setSearch] = useState<string | null>(null); // null = closed
  const [highlight, setHighlight] = useState<string | null>(null);
  const prefixes = useMediaPrefixes();
  const presence = usePresence(session, chatId);
  const resolveName = useNameResolver(session, chatId);
  const { data: sessionsForMe } = useSessions();
  const me = sessionsForMe?.find((x) => x.name === session)?.me;
  const myIds = useMemo(() => [me?.id, me?.lid, me?.jid].filter((x): x is string => !!x), [me]);
  const presenceText = presenceLabel(presence, chatId, isGroup(chatId), (id) => resolveName(id) ?? displayId(id));

  // Messages arrive newest-first from the API; render oldest-first.
  const ordered = useMemo(() => [...(messages ?? [])].sort((a, b) => a.timestamp - b.timestamp), [messages]);

  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** After a jump-to-date the newest messages are not loaded; page forward until caught up. */
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [datePick, setDatePick] = useState(false);
  const pendingPrepend = useRef<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Scroll management:
  // - first batch for a chat → jump to the newest message (bottom)
  // - new messages while the user is at the bottom (or sent by me) → stay at bottom
  // - prepending older messages → keep the viewport where it was
  // - content growing (media loading) while at the bottom → stay at bottom
  const atBottomRef = useRef(true);
  const skipAutoScroll = useRef(false);
  const initialScrolled = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);

  useEffect(() => {
    initialScrolled.current = false;
    atBottomRef.current = true;
    prevLen.current = 0;
  }, [chatId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pendingPrepend.current !== null) {
      el.scrollTop += el.scrollHeight - pendingPrepend.current;
      pendingPrepend.current = null;
      prevLen.current = ordered.length;
      return;
    }
    if (skipAutoScroll.current) {
      // Newer page appended below: keep the viewport where it is.
      skipAutoScroll.current = false;
      prevLen.current = ordered.length;
      return;
    }
    if (!initialScrolled.current && ordered.length > 0) {
      el.scrollTop = el.scrollHeight;
      initialScrolled.current = true;
      prevLen.current = ordered.length;
      return;
    }
    const grew = ordered.length > prevLen.current;
    prevLen.current = ordered.length;
    const last = ordered[ordered.length - 1];
    if (grew && (atBottomRef.current || last?.fromMe)) el.scrollTop = el.scrollHeight;
  }, [ordered]);

  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const el = listRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (el.scrollTop < 150) void loadOlderRef.current();
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) void loadNewerRef.current();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Media/bubbles growing after render: keep pinned to the bottom if we were there.
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current && pendingPrepend.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [chatId]);

  useEffect(() => {
    setHasMore(true);
  }, [chatId]);

  const setOpen = useUnread((s) => s.setOpen);
  const markSeen = useUnread((s) => s.markSeen);
  useEffect(() => {
    setOpen(chatKey(session, chatId));
    return () => setOpen(null);
  }, [session, chatId, setOpen]);
  useEffect(() => {
    markSeen(session, chatId);
    requireClient().sendSeen(session, chatId).catch(() => {});
  }, [session, chatId, ordered.length, markSeen]);

  const loadOlder = async () => {
    if (!ordered.length || loadingOlder || !hasMore || !initialScrolled.current) return;
    setLoadingOlder(true);
    try {
      const oldest = ordered[0]!.timestamp;
      const more = await requireClient().messages(session, chatId, {
        limit: 60,
        before: oldest - 1,
        downloadMedia: prefixes.length > 0,
        downloadMediaMimetypes: prefixes,
      });
      usePushNames.getState().learn(more);
      const fresh = more.filter((m) => !ordered.some((o) => o.id === m.id));
      if (fresh.length === 0) {
        setHasMore(false);
        return;
      }
      pendingPrepend.current = listRef.current?.scrollHeight ?? null;
      qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => [...(old ?? []), ...fresh]);
      if (more.length < 60) setHasMore(false);
    } finally {
      setLoadingOlder(false);
    }
  };

  loadOlderRef.current = loadOlder;

  const loadNewer = async () => {
    if (!ordered.length || loadingNewer || !hasNewer) return;
    setLoadingNewer(true);
    try {
      const newest = ordered[ordered.length - 1]!.timestamp;
      const more = await requireClient().messages(session, chatId, {
        limit: 60,
        after: newest + 1,
        sortOrder: "asc",
        downloadMedia: prefixes.length > 0,
        downloadMediaMimetypes: prefixes,
      });
      usePushNames.getState().learn(more);
      const fresh = more.filter((m) => !ordered.some((o) => o.id === m.id));
      if (fresh.length) {
        skipAutoScroll.current = true;
        atBottomRef.current = false;
        qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => [...fresh.reverse(), ...(old ?? [])]);
      }
      if (more.length < 60) setHasNewer(false);
    } finally {
      setLoadingNewer(false);
    }
  };
  const loadNewerRef = useRef(loadNewer);
  loadNewerRef.current = loadNewer;

  /** Replace the view with the 60 messages up to the end of `day` (local time). */
  const jumpToDate = async (day: string) => {
    const end = Math.floor(new Date(`${day}T23:59:59`).getTime() / 1000);
    const start = Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
    setDatePick(false);
    setLoadingOlder(true);
    try {
      const list = await requireClient().messages(session, chatId, {
        limit: 60,
        before: end,
        downloadMedia: prefixes.length > 0,
        downloadMediaMimetypes: prefixes,
      });
      usePushNames.getState().learn(list);
      qc.setQueryData(qk.messages(session, chatId), list);
      setHasMore(list.length >= 60);
      setHasNewer(true);
      atBottomRef.current = false;
      initialScrolled.current = false; // scroll to the bottom of the jumped page (≈ the chosen day)
      const first = [...list].reverse().find((m) => m.timestamp >= start);
      if (first) setTimeout(() => jumpTo(first.id), 50);
    } finally {
      setLoadingOlder(false);
    }
  };

  const backToLatest = () => {
    setHasNewer(false);
    setHasMore(true);
    initialScrolled.current = false;
    atBottomRef.current = true;
    void qc.resetQueries({ queryKey: qk.messages(session, chatId) });
  };

  // Trigger loadOlder when the top sentinel scrolls into view.
  useEffect(() => {
    const el = topRef.current;
    const root = listRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlder(), { root, rootMargin: "200px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, hasMore, loadingOlder]);

  const matches = useMemo(() => {
    const term = search?.trim().toLowerCase();
    if (!term) return [];
    return [...ordered].reverse().filter((m) => m.body?.toLowerCase().includes(term)).slice(0, 100);
  }, [ordered, search]);

  const jumpTo = (id: string) => {
    // Quoted ids are the bare WhatsApp id; full ids look like "true_<chat>_<id>[_<participant>]".
    const full = ordered.find((m) => m.id === id || m.id.split("_")[2] === id)?.id ?? id;
    setHighlight(full);
    document.getElementById(`msg-${full}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => setHighlight((h) => (h === full ? null : h)), 2000);
  };

  // ⌘/Ctrl+F opens in-chat search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearch((v) => (v === null ? "" : v));
        setTimeout(() => document.getElementById("msg-search")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
    <div className="flex-1 min-w-0 flex flex-col bg-[#efeae2] dark:bg-neutral-950">
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => setInfo((v) => !v)} title="Chat info">
          <Avatar src={chat?.picture} name={name} size={36} />
          <div className="min-w-0">
            <div className="font-medium truncate">{name}</div>
            <div className={cn("text-xs truncate", presenceText?.includes("typing") || presenceText?.includes("recording") ? "text-wa-dark dark:text-wa" : "text-neutral-500")}>
              {presenceText ?? displayId(chatId)}
            </div>
          </div>
        </button>
        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setDatePick((v) => !v)} title="Jump to date">
            <CalendarDays size={16} />
          </Button>
          {datePick && (
            <div className="absolute right-0 top-full mt-1 z-30 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-3 space-y-2 w-56">
              <div className="text-xs font-medium">Jump to date</div>
              <input
                type="date"
                autoFocus
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && void jumpToDate(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm outline-none"
              />
              <div className="text-[11px] text-neutral-500">Shows messages up to the end of that day.</div>
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setSearch((v) => (v === null ? "" : null)); setTimeout(() => document.getElementById("msg-search")?.focus(), 0); }} title="Search in chat (⌘F)">
          <Search size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setInfo((v) => !v)} title="Info">
          <Info size={16} />
        </Button>
      </header>
      {search !== null && (
        <div className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-neutral-400" />
            <input
              id="msg-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch(null);
                if (e.key === "Enter" && matches[0]) jumpTo(matches[0].id);
              }}
              placeholder="Search in loaded messages…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <span className="text-[11px] text-neutral-500">{search.trim() ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}</span>
            {hasMore && search.trim() && (
              <Button size="sm" variant="secondary" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? <Loader2 size={12} className="animate-spin" /> : "Load older"}
              </Button>
            )}
            <button onClick={() => setSearch(null)}><X size={14} /></button>
          </div>
          {search.trim() && matches.length > 0 && (
            <div className="max-h-40 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
              {matches.map((m) => (
                <button key={m.id} onClick={() => jumpTo(m.id)} className="w-full text-left px-1 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <span className="text-neutral-400 mr-2">{formatTime(m.timestamp)}</span>
                  <span className="font-medium mr-1">{m.fromMe ? "You" : (resolveName(m.participant || m.from) ?? senderName(m))}:</span>
                  <span className="opacity-80">{m.body.slice(0, 120)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div ref={contentRef} className="space-y-1">
        {isLoading && <Loader2 className="animate-spin text-neutral-400" />}
        {error && <div className="text-sm text-red-600 selectable">{(error as Error).message}</div>}
        <div ref={topRef} className="h-6 grid place-items-center text-neutral-400">
          {loadingOlder && <Loader2 size={16} className="animate-spin" />}
          {!hasMore && ordered.length > 0 && <span className="text-[11px]">Beginning of conversation</span>}
        </div>
        {ordered.map((m, i) => {
          const prev = ordered[i - 1];
          const newDay = !prev || new Date(prev.timestamp * 1000).toDateString() !== new Date(m.timestamp * 1000).toDateString();
          return (
            <div key={m.id} id={`msg-${m.id}`} className={cn("rounded-lg transition-colors", highlight === m.id && "bg-amber-200/60 dark:bg-amber-500/20")}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                    {formatDateDivider(m.timestamp)}
                  </span>
                </div>
              )}
              <Bubble
                message={m}
                group={isGroup(chatId)}
                session={session}
                chatId={chatId}
                onReply={() => setReplyTo(m)}
                onMenu={(pos) => setMenu({ m, pos })}
                resolveName={resolveName}
                myIds={myIds}
                onJump={jumpTo}
              />
            </div>
          );
        })}
        {hasNewer && (
          <div className="h-6 grid place-items-center text-neutral-400">{loadingNewer && <Loader2 size={16} className="animate-spin" />}</div>
        )}
        </div>
      </div>
      {hasNewer && (
        <div className="relative">
          <button
            onClick={backToLatest}
            className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 rounded-full bg-wa-dark text-white px-3 py-1.5 text-xs shadow-lg hover:bg-wa-teal"
          >
            <ArrowDown size={14} /> Jump to latest
          </button>
        </div>
      )}

      <Composer
        session={session}
        chatId={chatId}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        editing={editing}
        onClearEdit={() => setEditing(null)}
        resolveName={resolveName}
        myIds={myIds}
      />
      {menu && (
        <MessageMenu
          message={menu.m}
          session={session}
          chatId={chatId}
          pos={menu.pos}
          onClose={() => setMenu(null)}
          onReply={() => setReplyTo(menu.m)}
          onEdit={() => setEditing(menu.m)}
        />
      )}
    </div>
    {info && <InfoPanel session={session} chatId={chatId} chat={chat} myIds={myIds} onClose={() => setInfo(false)} />}
    </>
  );
}

function senderName(m: WAMessage) {
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  return d.Info?.PushName || displayId(m.participant || m.from);
}

function Bubble({
  message: m,
  group,
  session,
  chatId,
  onReply,
  onMenu,
  resolveName,
  myIds,
  onJump,
}: {
  message: WAMessage;
  group: boolean;
  session: string;
  chatId: string;
  onReply: () => void;
  onMenu: (pos: MenuPos) => void;
  resolveName: MentionResolver;
  myIds: string[];
  onJump: (id: string) => void;
}) {
  const mine = m.fromMe;
  const sticker = m.hasMedia && !m.body && mediaKind(m) === "sticker";
  const reactionMap = useReactions((s) => s.byMsg[bareId(m.id)]);
  const reactions = summarize(reactionMap, myIds.map((x) => x.split("@")[0]!.split(":")[0]!));
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col max-w-[70%]", mine ? "items-end" : "items-start")}>
      <div
        onDoubleClick={onReply}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu({ x: e.clientX, y: e.clientY });
        }}
        title="Double-click to reply · right-click for more"
        className={cn(
          "rounded-lg px-3 py-1.5 text-sm selectable",
          sticker
            ? "bg-transparent"
            : mine
              ? "bg-[#d9fdd3] dark:bg-wa-teal text-neutral-900 dark:text-white shadow-sm"
              : "bg-white dark:bg-neutral-800 shadow-sm",
        )}
      >
        {group && !mine && (
          <div className="text-[11px] font-semibold text-wa-dark dark:text-wa mb-0.5">
            {resolveName(m.participant || m.from) ?? senderName(m)}
          </div>
        )}
        {m.replyTo && (
          <QuoteView
            quote={m.replyTo as ReplyTo}
            resolveName={resolveName}
            myIds={myIds}
            onClick={() => onJump((m.replyTo as ReplyTo).id)}
            className="mb-1"
          />
        )}
        {m.hasMedia && (
          <div className="mb-1">
            <MediaView message={m} session={session} chatId={chatId} />
          </div>
        )}
        {m.location && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void openUrl(`https://maps.google.com/?q=${m.location!.latitude},${m.location!.longitude}`);
            }}
            className="block text-xs underline text-sky-600 dark:text-sky-400"
          >
            📍 {(m.location as { title?: string }).title || "Location"} · {m.location.latitude}, {m.location.longitude}
          </a>
        )}
        {m.vCards?.map((v, i) => <VCardView key={i} vcard={v} />)}
        <PollView message={m} />
        {m.body && (
          <div className="break-words">
            <WaMarkdown text={m.body} mentions={resolveName} />
          </div>
        )}
        {m.body && !m.hasMedia && <LinkPreviewCard message={m} />}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-300/70">
          {formatTime(m.timestamp)}
          {mine && <AckIcon ack={m.ack} />}
        </div>
      </div>
      {reactions.length > 0 && (
        <div className="-mt-2 mx-2 flex gap-1 z-10">
          {reactions.map((r) => (
            <span
              key={r.emoji}
              title={r.me ? "You reacted" : undefined}
              className={cn(
                "rounded-full bg-white dark:bg-neutral-800 border px-1.5 py-px text-[12px] leading-4 shadow-sm",
                r.me ? "border-wa-dark" : "border-neutral-200 dark:border-neutral-700",
              )}
            >
              {r.emoji}
              {r.count > 1 && <span className="ml-0.5 text-[10px] text-neutral-500">{r.count}</span>}
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function VCardView({ vcard }: { vcard: string }) {
  const name = vcard.match(/^FN:(.*)$/m)?.[1] ?? "Contact";
  const tel = vcard.match(/^TEL[^:]*:(.*)$/m)?.[1] ?? "";
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2 my-1">
      <Avatar name={name} size={32} />
      <div className="min-w-0">
        <div className="font-medium truncate">{name}</div>
        <div className="text-xs opacity-70 selectable">{tel}</div>
      </div>
    </div>
  );
}

function PollView({ message: m }: { message: WAMessage }) {
  const msg = (m._data as { Message?: Record<string, { name?: string; options?: { optionName: string }[]; selectableOptionsCount?: number }> } | undefined)?.Message;
  const poll = msg?.pollCreationMessageV3 ?? msg?.pollCreationMessage ?? msg?.pollCreationMessageV2;
  if (!poll) return null;
  return (
    <div className="my-1 space-y-1">
      <div className="font-medium">📊 {poll.name}</div>
      {poll.options?.map((o, i) => (
        <div key={i} className="rounded-md bg-black/5 dark:bg-white/10 px-2 py-1 text-xs">
          {o.optionName}
        </div>
      ))}
      <div className="text-[10px] opacity-60">{poll.selectableOptionsCount === 0 ? "Multiple answers" : "Single answer"}</div>
    </div>
  );
}

function AckIcon({ ack, className }: { ack: number; className?: string }) {
  if (ack <= 0) return <Clock size={12} className={className} />;
  if (ack === 1) return <Check size={12} className={className} />;
  if (ack === 2) return <CheckCheck size={12} className={className} />;
  return <CheckCheck size={12} className={cn("text-sky-500", className)} />;
}

// ── Composer ─────────────────────────────────────────────────────────────

function Composer({
  session,
  chatId,
  replyTo,
  onClearReply,
  editing,
  onClearEdit,
  resolveName,
  myIds,
}: {
  session: string;
  chatId: string;
  replyTo: WAMessage | null;
  onClearReply: () => void;
  editing: WAMessage | null;
  onClearEdit: () => void;
  resolveName: MentionResolver;
  myIds: string[];
}) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dialog, setDialog] = useState<AttachKind | null>(null);
  const [fileAccept, setFileAccept] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const send = useSendText(session, chatId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, [chatId, replyTo, editing]);

  useEffect(() => {
    if (editing) setText(editing.body);
  }, [editing]);

  // Typing presence: fire startTyping at most every 4s while typing, stopTyping after 5s idle.
  const typingRef = useRef<{ last: number; timer?: ReturnType<typeof setTimeout> }>({ last: 0 });
  const stopTyping = () => {
    clearTimeout(typingRef.current.timer);
    if (typingRef.current.last) {
      typingRef.current.last = 0;
      requireClient().stopTyping(session, chatId).catch(() => {});
    }
  };
  const noteTyping = () => {
    const now = Date.now();
    if (now - typingRef.current.last > 4000) {
      typingRef.current.last = now;
      requireClient().startTyping(session, chatId).catch(() => {});
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 5000);
  };
  useEffect(() => stopTyping, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setErr(null);
    stopTyping();
    if (editing) {
      try {
        await requireClient().editMessage(session, chatId, editing.id, t);
        qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) =>
          old?.map((m) => (m.id === editing.id ? { ...m, body: t } : m)),
        );
        setText("");
        onClearEdit();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setText("");
    try {
      await send.mutateAsync({ text: t, replyTo: replyTo?.id });
      onClearReply();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setText(t);
    }
  };

  /** Put a freshly sent message into the cache and refresh the chat list. */
  const appendSent = (msg: WAMessage) => {
    qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => (old ? [msg, ...old] : old));
    qc.invalidateQueries({ queryKey: qk.chats(session) });
  };

  const attach = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const c = requireClient();
      const data = await fileToBase64(file);
      const payload = { mimetype: file.type || "application/octet-stream", filename: file.name, data };
      const caption = text.trim() || undefined;
      const msg = file.type.startsWith("image/")
        ? await c.sendImage(session, chatId, payload, caption)
        : file.type.startsWith("video/")
          ? await c.sendVideo(session, chatId, payload, caption)
          : await c.sendFile(session, chatId, payload, caption);
      setText("");
      appendSent(msg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pick = (k: AttachKind) => {
    if (k === "image" || k === "file") {
      setFileAccept(k === "image" ? "image/*,video/*" : undefined);
      // Let React apply `accept` before opening the native picker.
      setTimeout(() => fileRef.current?.click(), 0);
      return;
    }
    setDialog(k);
  };

  const blobToBase64 = (b: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]!);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(b);
    });

  return (
    <div className="shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
      {editing && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs">
          <span className="font-semibold text-amber-700 dark:text-amber-300">Editing message</span>
          <span className="truncate flex-1 opacity-80">{editing.body}</span>
          <button onClick={() => { onClearEdit(); setText(""); }}>
            <X size={14} />
          </button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="flex items-center gap-2">
          <QuoteView quote={replyTo} resolveName={resolveName} myIds={myIds} className="flex-1" />
          <button onClick={onClearReply} title="Cancel reply">
            <X size={14} />
          </button>
        </div>
      )}
      {err && <div className="text-xs text-red-600 selectable">{err}</div>}
      {dialog === "voice" && (
        <VoiceRecorder
          onClose={() => setDialog(null)}
          onSend={async (blob, mime) => {
            const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
            appendSent(await requireClient().sendVoice(session, chatId, { mimetype: mime.split(";")[0]!, filename: `voice.${ext}`, data: await blobToBase64(blob) }));
          }}
        />
      )}
      {dialog === "location" && (
        <LocationDialog
          onClose={() => setDialog(null)}
          onSend={async (lat, lng, title) => appendSent(await requireClient().sendLocation(session, chatId, lat, lng, title))}
        />
      )}
      {dialog === "contact" && (
        <ContactDialog
          onClose={() => setDialog(null)}
          onSend={async (name, phone, org) => appendSent(await requireClient().sendContactVcard(session, chatId, [{ fullName: name, phoneNumber: phone, organization: org || undefined }]))}
        />
      )}
      {dialog === "poll" && (
        <PollDialog
          onClose={() => setDialog(null)}
          onSend={async (name, options, multiple) => appendSent(await requireClient().sendPoll(session, chatId, name, options, multiple))}
        />
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={fileAccept}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
          }}
        />
        <AttachMenu disabled={uploading} onPick={pick} />
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) noteTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape" && editing) {
              onClearEdit();
              setText("");
            }
          }}
          rows={1}
          placeholder="Type a message (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-sm outline-none max-h-40"
          style={{ height: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 160) + "px";
          }}
        />
        <Button onClick={submit} disabled={!text.trim() || send.isPending} title="Send">
          {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
}

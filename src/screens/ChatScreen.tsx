import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search, CheckCheck, X, Info, CalendarDays, ArrowDown } from "lucide-react";
import { useChats, useMessages, useSessions, useMediaPrefixes, qk } from "@/api/queries";
import { requireClient, useSettings } from "@/store/settings";
import { Avatar, Button } from "@/components/ui";
import { MessageMenu, type MenuPos } from "@/components/MessageMenu";
import { InfoPanel } from "@/components/InfoPanel";
import { usePresence, presenceLabel } from "@/realtime/usePresence";
import { useNameResolver } from "@/realtime/useNames";
import { ResizeHandle, usePaneWidth } from "@/components/ResizeHandle";
import { MessageInfoModal } from "@/components/MessageInfo";
import { ContactModal } from "@/components/ContactModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { confirm } from "@/components/Confirm";
import { useHidden } from "@/store/hidden";
import { tombstonesFor, useRevoked } from "@/store/revoked";
import { useLiveMessages } from "@/store/liveMessages";
import { bareId } from "@/store/reactions";
import { useChatPrefs, type AutoTranslate } from "@/store/chatPrefs";
const EMPTY_AUTO: AutoTranslate = {};
import { exportChat, type ExportFormat } from "@/lib/exportChat";
import { MoreVertical, Download, Languages, Sparkles } from "lucide-react";
import { SummaryModal } from "@/components/SummaryModal";
import { useTranslations } from "@/store/translations";
import { aiConfigured, translate, LANGUAGES } from "@/lib/ai";
import type { WAMessage } from "@/api/types";
import { cn, displayId, formatDateDivider, formatTime, isGroup } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { chatKey, useUnread } from "@/store/unread";
import { usePushNames } from "@/store/pushNames";
import { useWaWeb } from "@/store/waWeb";
import { WhatsAppWebScreen } from "@/screens/WhatsAppWebScreen";
import { NotConnected } from "@/components/NotConnected";

import { ChatList, SessionPicker } from "@/screens/chats/ChatList";
import { Bubble, senderName } from "@/screens/chats/MessageBubble";
import { Composer } from "@/screens/chats/Composer";

export function ChatScreen() {
  const { client, session } = useSettings();
  const { data: sessions } = useSessions();
  const [selected, setSelected] = useState<string | null>(null);
  // A chat id belongs to one session: switching servers/sessions must drop the selection.
  useEffect(() => setSelected(null), [session]);
  const [listWidth, setListWidth] = usePaneWidth("chatList", 320, 240, 560);
  const waWebActive = useWaWeb((s) => s.active);
  const waWebSessions = useWaWeb((s) => s.sessions);
  const addWaWeb = useWaWeb((s) => s.add);

  const sessionInfo = sessions?.find((s) => s.name === session);
  const waWeb = waWebSessions.find((s) => s.id === waWebActive);

  if (waWeb) {
    return <WhatsAppWebScreen header={<SessionPicker sessions={sessions ?? []} />} />;
  }
  if (!client) {
    return (
      <NotConnected>
        <Button variant="secondary" onClick={() => addWaWeb()}>Use WhatsApp Web instead</Button>
      </NotConnected>
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
        <Conversation key={`${session}:${selected}`} session={session} chatId={selected} onOpenChat={setSelected} />
      ) : (
        <Empty>Select a chat</Empty>
      )}
    </>
  );
}

/** Merge a page into the cached list, dropping ids already present (concurrent pages, live echoes). */
function appendUnique(old: WAMessage[], fresh: WAMessage[], where: "start" | "end"): WAMessage[] {
  const have = new Set(old.map((m) => m.id));
  const add = fresh.filter((m) => !have.has(m.id));
  if (!add.length) return old;
  return where === "end" ? [...old, ...add] : [...add, ...old];
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center text-neutral-500 text-sm">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}


function Conversation({ session, chatId, onOpenChat }: { session: string; chatId: string; onOpenChat: (id: string) => void }) {
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
  const [msgInfo, setMsgInfo] = useState<WAMessage | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState(false);
  const autoTr = useChatPrefs((s) => s.autoTranslate[`${session}:${chatId}`] ?? EMPTY_AUTO);
  const setAutoTranslate = useChatPrefs((s) => s.setAutoTranslate);
  // Last-opened time captured before markSeen() below overwrites it, for "since I last read" summaries.
  const seenAtRef = useRef<number | undefined>(undefined);
  const readMode = useSettings((s) => s.readReceipts);
  const [readSentFor, setReadSentFor] = useState<string | null>(null); // id of the last incoming message we've acknowledged manually
  const [search, setSearch] = useState<string | null>(null); // null = closed
  const [highlight, setHighlight] = useState<string | null>(null);
  const prefixes = useMediaPrefixes();
  const presence = usePresence(session, chatId);
  const resolveName = useNameResolver(session, chatId);
  const { data: sessionsForMe } = useSessions();
  const me = sessionsForMe?.find((x) => x.name === session)?.me;
  const meId = me?.id, meLid = me?.lid, meJid = me?.jid;
  const myIds = useMemo(() => [meId, meLid, meJid].filter((x): x is string => !!x), [meId, meLid, meJid]);
  const presenceText = presenceLabel(presence, chatId, isGroup(chatId), (id) => resolveName(id) ?? displayId(id));

  // Messages arrive newest-first from the API; render oldest-first, minus the ones deleted "for me".
  const hiddenIds = useHidden((s) => s.ids);
  const revokedItems = useRevoked((s) => s.items);
  const live = useLiveMessages((s) => s.byChat[`${session}:${chatId}`]);
  const ordered = useMemo(() => {
    const list: (WAMessage & { revoked?: boolean; waiting?: boolean })[] = (messages ?? []).filter((m) => !hiddenIds[m.id]);
    // Messages we received live but the server no longer returns (WAHA storage gaps): keep them in the loaded range.
    if (live?.length && messages) {
      const have = new Set(list.map((m) => m.id));
      const oldest = list.length ? Math.min(...list.map((m) => m.timestamp)) : 0;
      for (const m of live) if (!have.has(m.id) && !hiddenIds[m.id] && m.timestamp >= oldest) list.push(m);
    }
    const stones = tombstonesFor(revokedItems, `${session}:${chatId}`);
    if (stones.length) {
      const have = new Map(list.map((m) => [bareId(m.id), m]));
      const oldest = list.length ? Math.min(...list.map((m) => m.timestamp)) : 0;
      for (const t of stones) {
        const existing = have.get(t.id);
        if (existing) {
          // Never mutate the react-query cache object: replace it with a flagged copy.
          if ((t.kind ?? "revoked") === "revoked" && !existing.revoked) list[list.indexOf(existing)] = { ...existing, revoked: true };
          continue; // the real message arrived → no "waiting" placeholder needed
        }
        if (t.timestamp >= oldest) {
          // Synthesize a placeholder in the loaded range so it keeps its position.
          list.push({
            id: `revoked_${chatId}_${t.id}`,
            timestamp: t.timestamp,
            from: t.from ?? chatId,
            to: chatId,
            fromMe: t.fromMe,
            participant: t.participant ?? "",
            body: "",
            hasMedia: false,
            ack: 0,
            ackName: "",
            source: "app",
            mediaUrl: "",
            revoked: (t.kind ?? "revoked") === "revoked",
            waiting: t.kind === "waiting",
          } as WAMessage & { revoked: boolean; waiting: boolean });
        }
      }
    }
    return list.sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, hiddenIds, revokedItems, session, chatId, live]);

  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** After a jump-to-date the newest messages are not loaded; page forward until caught up. */
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [datePick, setDatePick] = useState(false);
  const pendingPrepend = useRef<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // Synchronous in-flight guards: the scroll handler and the IntersectionObserver can both
  // fire before React commits `loadingOlder`, which would page the same range twice.
  const olderInFlight = useRef(false);
  const newerInFlight = useRef(false);

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

  // Only the visible bubbles (plus a buffer) are in the DOM; a long scroll-back no longer
  // keeps thousands of bubbles, images and blob URLs alive. Heights are measured per item
  // (media loading later re-measures via the virtualizer's ResizeObserver), and the
  // virtualizer compensates scrollTop when an item above the viewport changes size.
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: (i) => ordered[i]!.id,
    // The list container sits below the loader / top sentinel inside the scroll element.
    scrollMargin: contentRef.current?.offsetTop ?? 0,
  });

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

  // Auto-translate incoming: the newest incoming messages that have no translation yet. Each id is tried once per target.
  const autoTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    const target = autoTr.in;
    if (!target || !aiConfigured()) return;
    const t = useTranslations.getState();
    const todo = [...ordered].reverse().filter((m) => !m.fromMe && m.body && !(m as WAMessage & { waiting?: boolean }).waiting).slice(0, 20)
      .filter((m) => !t.byMsg[m.id] && !autoTried.current.has(`${target}:${m.id}`));
    for (const m of todo) {
      autoTried.current.add(`${target}:${m.id}`);
      t.set(m.id, { target, loading: true });
      translate(m.body, target, m.id)
        .then((text) => useTranslations.getState().set(m.id, { target, text }))
        .catch((e) => useTranslations.getState().set(m.id, { target, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [ordered, autoTr.in]);
  const setOpen = useUnread((s) => s.setOpen);
  const markSeen = useUnread((s) => s.markSeen);
  useEffect(() => {
    seenAtRef.current = useUnread.getState().lastSeen[chatKey(session, chatId)];
    setOpen(chatKey(session, chatId));
    return () => setOpen(null);
  }, [session, chatId, setOpen]);
  // Re-ack only when a new incoming message arrives — not when older history pages in.
  const newestIncomingId = useMemo(() => {
    for (let i = ordered.length - 1; i >= 0; i--) if (!ordered[i]!.fromMe) return ordered[i]!.id;
    return null;
  }, [ordered]);
  useEffect(() => {
    markSeen(session, chatId);
    if (useSettings.getState().readReceipts === "always") requireClient().sendSeen(session, chatId).catch(() => {});
  }, [session, chatId, newestIncomingId, markSeen]);

  const loadOlder = async () => {
    if (!ordered.length || olderInFlight.current || loadingOlder || !hasMore || !initialScrolled.current) return;
    olderInFlight.current = true;
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
      qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => appendUnique(old ?? [], fresh, "end"));
      // WAHA applies `limit` before filtering out hidden message types, so a page can be
      // shorter than `limit` while older messages still exist — only an empty page means the end.
    } finally {
      olderInFlight.current = false;
      setLoadingOlder(false);
    }
  };

  loadOlderRef.current = loadOlder;

  const loadNewer = async () => {
    if (!ordered.length || newerInFlight.current || loadingNewer || !hasNewer) return;
    newerInFlight.current = true;
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
        qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => appendUnique(old ?? [], fresh.reverse(), "start"));
      } else {
        setHasNewer(false);
      }
    } finally {
      newerInFlight.current = false;
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
      setHasMore(list.length > 0);
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
  // Observe once per chat; `loadOlderRef` always points at the latest closure (with current hasMore/loading state).
  useEffect(() => {
    const el = topRef.current;
    const root = listRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlderRef.current(), { root, rootMargin: "200px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [chatId]);

  const matches = useMemo(() => {
    const term = search?.trim().toLowerCase();
    if (!term) return [];
    return [...ordered].reverse().filter((m) => m.body?.toLowerCase().includes(term)).slice(0, 100);
  }, [ordered, search]);

  const jumpTo = (id: string) => {
    // Quoted ids are the bare WhatsApp id; full ids look like "true_<chat>_<id>[_<participant>]".
    const idx = ordered.findIndex((m) => m.id === id || m.id.split("_")[2] === id);
    const full = idx >= 0 ? ordered[idx]!.id : id;
    setHighlight(full);
    if (idx >= 0) {
      // Positions above the viewport are estimates until measured: scroll, let the target
      // render and measure, then correct once.
      atBottomRef.current = false;
      virtualizer.scrollToIndex(idx, { align: "center" });
      setTimeout(() => virtualizer.scrollToIndex(idx, { align: "center" }), 60);
    }
    setTimeout(() => setHighlight((h) => (h === full ? null : h)), 2000);
  };
  // Stable identities so memoised bubbles don't re-render on every parent tick.
  const jumpToRef = useRef(jumpTo);
  jumpToRef.current = jumpTo;
  const onJumpStable = useCallback((id: string) => jumpToRef.current(id), []);
  const onReplyStable = useCallback((m: WAMessage) => setReplyTo(m), []);
  const onMenuStable = useCallback((m: WAMessage, pos: MenuPos) => setMenu({ m, pos }), []);
  const onSenderStable = useCallback((id: string) => setContactId(id), []);
  const group = isGroup(chatId);

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
        {readMode === "manual" && (() => {
          const lastIn = [...ordered].reverse().find((m) => !m.fromMe);
          const pending = !!lastIn && readSentFor !== lastIn.id;
          return (
            <Button
              variant={pending ? "primary" : "ghost"}
              size="sm"
              title={pending ? "Send read receipt (blue ticks) for this chat" : "Read receipt already sent"}
              disabled={!pending}
              onClick={async () => {
                try {
                  await requireClient().sendSeen(session, chatId);
                  setReadSentFor(lastIn!.id);
                } catch (e) {
                  await confirm({ title: "Couldn't send read receipt", message: e instanceof Error ? e.message : String(e), confirmLabel: "OK" });
                }
              }}
            >
              <CheckCheck size={16} className={pending ? "" : "text-sky-500"} />
            </Button>
          );
        })()}
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
        {aiConfigured() && (
          <Button variant="ghost" size="sm" onClick={() => setSummary(true)} title="Summarize with AI">
            <Sparkles size={16} />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => { setSearch((v) => (v === null ? "" : null)); setTimeout(() => document.getElementById("msg-search")?.focus(), 0); }} title="Search in chat (⌘F)">
          <Search size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setInfo((v) => !v)} title="Info">
          <Info size={16} />
        </Button>
        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setMoreOpen((v) => !v)} title="More"><MoreVertical size={16} /></Button>
          {moreOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-sm" onMouseLeave={() => setMoreOpen(false)}>
              <button
                onClick={() => { setMoreOpen(false); setSummary(true); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Sparkles size={14} /> Summarize with AI
              </button>
              {aiConfigured() && (
                <div className="px-3 py-1.5 space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] text-neutral-500"><Languages size={12} /> Auto-translate (this chat)</div>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-neutral-500">Incoming →</span>
                    <select
                      value={autoTr.in ?? ""}
                      onChange={(e) => setAutoTranslate(`${session}:${chatId}`, { in: e.target.value || undefined })}
                      className="flex-1 min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-xs outline-none"
                    >
                      <option value="">Off</option>
                      {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-neutral-500">My messages →</span>
                    <select
                      value={autoTr.out ?? ""}
                      onChange={(e) => setAutoTranslate(`${session}:${chatId}`, { out: e.target.value || undefined })}
                      className="flex-1 min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-xs outline-none"
                    >
                      <option value="">Off (send as typed)</option>
                      {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </label>
                  <div className="text-[10px] text-neutral-400">Incoming: shown under each new message. Outgoing: your draft is translated right before sending.</div>
                </div>
              )}
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              <div className="px-3 py-1 text-[11px] text-neutral-500">Export loaded messages ({ordered.length})</div>
              {(["txt", "html", "json"] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  disabled={exporting}
                  onClick={async () => {
                    setMoreOpen(false);
                    setExporting(true);
                    try {
                      const p = await exportChat(name, ordered.filter((m) => !(m as WAMessage & { waiting?: boolean }).waiting), f, resolveName);
                      if (p) await confirm({ title: "Exported", message: p, confirmLabel: "OK" });
                    } catch (e) {
                      await confirm({ title: "Export failed", message: e instanceof Error ? e.message : String(e), confirmLabel: "OK" });
                    } finally {
                      setExporting(false);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <Download size={14} /> Export as .{f}
                </button>
              ))}
              <div className="px-3 py-1 text-[10px] text-neutral-400">Scroll up first to include older messages.</div>
            </div>
          )}
        </div>
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

      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4 relative">
        {isLoading && <Loader2 className="animate-spin text-neutral-400" />}
        {error && <div className="text-sm text-red-600 selectable">{(error as Error).message}</div>}
        <div ref={topRef} className="h-6 grid place-items-center text-neutral-400">
          {loadingOlder && <Loader2 size={16} className="animate-spin" />}
          {!hasMore && ordered.length > 0 && <span className="text-[11px]">Beginning of conversation</span>}
        </div>
        <div ref={contentRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const i = v.index;
          const m = ordered[i]!;
          const prev = ordered[i - 1];
          const newDay = !prev || new Date(prev.timestamp * 1000).toDateString() !== new Date(m.timestamp * 1000).toDateString();
          return (
            <div
              key={m.id}
              ref={virtualizer.measureElement}
              data-index={i}
              className="pb-1"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
            >
            <div id={`msg-${m.id}`} className={cn("rounded-lg transition-colors", highlight === m.id && "bg-amber-200/60 dark:bg-amber-500/20")}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                    {formatDateDivider(m.timestamp)}
                  </span>
                </div>
              )}
              <ErrorBoundary inline label="message">
                <Bubble
                  message={m}
                  group={group}
                  session={session}
                  chatId={chatId}
                  onReply={onReplyStable}
                  onMenu={onMenuStable}
                  resolveName={resolveName}
                  myIds={myIds}
                  onJump={onJumpStable}
                  onSender={onSenderStable}
                />
              </ErrorBoundary>
            </div>
            </div>
          );
        })}
        </div>
        {hasNewer && (
          <div className="h-6 grid place-items-center text-neutral-400">{loadingNewer && <Loader2 size={16} className="animate-spin" />}</div>
        )}
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
        onEditLast={() => {
          const last = [...ordered].reverse().find((m) => m.fromMe && m.body && Date.now() / 1000 - m.timestamp < 15 * 60);
          if (last) setEditing(last);
        }}
        recent={ordered.slice(-30)}
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
          onInfo={() => setMsgInfo(menu.m)}
        />
      )}
      {msgInfo && <MessageInfoModal message={msgInfo} chatId={chatId} resolveName={resolveName} onClose={() => setMsgInfo(null)} />}
      {contactId && (
        <ContactModal
          session={session}
          id={contactId}
          resolveName={resolveName}
          onOpenChat={(id) => onOpenChat(id)}
          onClose={() => setContactId(null)}
        />
      )}
    </div>
    {info && <InfoPanel session={session} chatId={chatId} chat={chat} myIds={myIds} onClose={() => setInfo(false)} />}
    {summary && (
      <SummaryModal
        session={session}
        chatId={chatId}
        chatName={name}
        messages={ordered}
        resolve={resolveName}
        seenAt={seenAtRef.current}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        onClose={() => setSummary(false)}
      />
    )}
    </>
  );
}

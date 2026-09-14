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
import { EmojiButton } from "@/components/EmojiPicker";
import { MessageInfoModal } from "@/components/MessageInfo";
import { ContactModal } from "@/components/ContactModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { confirm } from "@/components/Confirm";
import { useHidden } from "@/store/hidden";
import { tombstonesFor, useRevoked } from "@/store/revoked";
import { useLiveMessages } from "@/store/liveMessages";
import { bareId, summarize, useReactions } from "@/store/reactions";
import { useDrafts } from "@/store/drafts";
import { MentionPicker, type MentionCandidate } from "@/components/MentionPicker";
import { QuickReplyPicker } from "@/components/QuickReplyPicker";
import { useGroupInfo } from "@/realtime/useNames";
import { useChatPrefs, type AutoTranslate } from "@/store/chatPrefs";
const EMPTY_AUTO: AutoTranslate = {};
import { usePolls } from "@/store/polls";
import { Pin, BellOff } from "lucide-react";
import { LabelsDialog, useLabelMap, useLabels } from "@/components/LabelsDialog";
import { exportChat, type ExportFormat } from "@/lib/exportChat";
import { MoreVertical, Download, Languages, Sparkles, WandSparkles, Undo2, RefreshCw, ScanText, Copy, Loader2 as Spinner } from "lucide-react";
import { SummaryModal } from "@/components/SummaryModal";
import { useTranslations } from "@/store/translations";
import { useImageNotes } from "@/store/imageNotes";
import { aiConfigured, translate, langName, rewriteDraft, smartReplies, REWRITE_MODES, LANGUAGES, type RewriteMode } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import type { MentionResolver } from "@/lib/waMarkdown";
import { WaMarkdown, stripWaMarkdown, replaceMentions } from "@/lib/waMarkdown";
import type { ChatOverview, WAMessage } from "@/api/types";
import { cn, displayId, fileToBase64, formatDateDivider, formatTime, isChannel, isGroup } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chatKey, unreadFor, useUnread } from "@/store/unread";
import { usePushNames } from "@/store/pushNames";
import { useWaWeb } from "@/store/waWeb";
import { WhatsAppWebScreen } from "@/screens/WhatsAppWebScreen";

export function ChatScreen({ onNeedSetup }: { onNeedSetup: () => void }) {
  const { client, session } = useSettings();
  const { data: sessions } = useSessions();
  const [selected, setSelected] = useState<string | null>(null);
  const [listWidth, setListWidth] = usePaneWidth("chatList", 320, 240, 560);
  const waWebActive = useWaWeb((s) => s.active);
  const waWebSessions = useWaWeb((s) => s.sessions);
  const addWaWeb = useWaWeb((s) => s.add);

  const sessionInfo = sessions?.find((s) => s.name === session);
  const waWeb = waWebSessions.find((s) => s.id === waWebActive);

  if (waWeb) {
    return <WhatsAppWebScreen key={waWeb.id} session={waWeb} header={<SessionPicker sessions={sessions ?? []} />} />;
  }
  if (!client) {
    return (
      <Empty>
        <p>Not connected.</p>
        <Button onClick={onNeedSetup}>Open settings</Button>
        <Button variant="secondary" onClick={() => addWaWeb()}>Use WhatsApp Web instead</Button>
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
        <Conversation key={selected} session={session} chatId={selected} onOpenChat={setSelected} />
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
  const resolveName = useNameResolver(session); // session-wide (contacts, LIDs, push names) for preview mentions
  const [q, setQ] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ chat: ChatOverview; x: number; y: number } | null>(null);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread" | "groups" | "archived">("all");
  const pinned = useChatPrefs((s) => s.pinned);
  const muted = useChatPrefs((s) => s.muted);
  const archived = useChatPrefs((s) => s.archived);
  const togglePref = useChatPrefs((s) => s.toggle);
  const { data: labels } = useLabels(session);
  const { data: labelMap } = useLabelMap(session);
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [labelsFor, setLabelsFor] = useState<ChatOverview | null>(null);
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
    const key = (c: ChatOverview) => `${session}:${c.id}`;
    if (filter === "archived") list = list.filter((c) => archived[key(c)]);
    else list = list.filter((c) => !archived[key(c)]);
    if (filter === "groups") list = list.filter((c) => isGroup(c.id));
    if (filter === "unread") list = list.filter((c) => unreadFor({ counts, lastSeen }, session, c.id, c.lastMessage) > 0);
    if (labelFilter) list = list.filter((c) => labelMap?.[c.id]?.includes(labelFilter));
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((c) => (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term));
    // Pinned chats float to the top (most recently pinned first).
    return [...list].sort((a, b) => (pinned[key(b)] ?? 0) - (pinned[key(a)] ?? 0));
  }, [data, q, filter, counts, lastSeen, session, pinned, archived, labelFilter, labelMap]);
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
        <SessionPicker sessions={sessions ?? []} />
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
        <div className="flex gap-1 items-center flex-wrap">
          {(["all", "unread", "groups", "archived"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap",
                filter === f ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
              )}
            >
              {f}
            </button>
          ))}
          {labels && labels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium outline-none max-w-[96px] truncate", labelFilter ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300")}
              title="Filter by label"
            >
              <option value="">Label</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>
      </div>
      {newChat && <NewChatDialog session={session} onPick={onSelect} onClose={() => setNewChat(false)} />}
      {labelsFor && <LabelsDialog session={session} chatId={labelsFor.id} chatName={labelsFor.name || displayId(labelsFor.id)} onClose={() => setLabelsFor(null)} />}
      {rowMenu && (
        <ChatRowMenu
          chat={rowMenu.chat}
          pos={rowMenu}
          onClose={() => setRowMenu(null)}
          onDelete={async () => {
            const name = rowMenu.chat.name || displayId(rowMenu.chat.id);
            const ok = await confirm({ title: `Delete chat with ${name}?`, message: "Removes the conversation and its messages from this WhatsApp account (all your devices). This cannot be undone.", confirmLabel: "Delete chat", danger: true });
            if (!ok) return;
            try {
              await requireClient().deleteChat(session, rowMenu.chat.id);
              if (selected === rowMenu.chat.id) onSelect("");
              qc.invalidateQueries({ queryKey: qk.chats(session) });
            } catch (e) {
              await confirm({ title: "Couldn't delete chat", message: e instanceof Error ? e.message : String(e), confirmLabel: "OK" });
            }
          }}
          pinned={!!pinned[`${session}:${rowMenu.chat.id}`]}
          muted={!!muted[`${session}:${rowMenu.chat.id}`]}
          archived={!!archived[`${session}:${rowMenu.chat.id}`]}
          onPin={() => togglePref("pinned", `${session}:${rowMenu.chat.id}`)}
          onLabels={() => setLabelsFor(rowMenu.chat)}
          onMute={() => togglePref("muted", `${session}:${rowMenu.chat.id}`)}
          onArchive={async () => {
            const key = `${session}:${rowMenu.chat.id}`;
            const wasArchived = !!archived[key];
            try {
              if (wasArchived) await requireClient().unarchiveChat(session, rowMenu.chat.id);
              else await requireClient().archiveChat(session, rowMenu.chat.id);
              togglePref("archived", key, !wasArchived);
              qc.invalidateQueries({ queryKey: qk.chats(session) });
            } catch (e) {
              await confirm({ title: wasArchived ? "Couldn't unarchive chat" : "Couldn't archive chat", message: e instanceof Error ? e.message : String(e), confirmLabel: "OK" });
            }
          }}
          onUnread={async () => {
            try {
              await requireClient().markUnread(session, rowMenu.chat.id);
            } catch (e) {
              await confirm({ title: "Couldn't mark unread", message: e instanceof Error ? e.message : String(e), confirmLabel: "OK" });
            }
          }}
        />
      )}
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
                <ChatRow chat={c} session={session} active={c.id === selected} resolveName={resolveName} onClick={() => onSelect(c.id)} onContextMenu={(x, y) => setRowMenu({ chat: c, x, y })} />
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

const WAWEB_NEW = "waweb:new";

/** WAHA sessions and WhatsApp Web sessions in one dropdown; picking a WhatsApp Web one swaps the screen. */
function SessionPicker({ sessions }: { sessions: { name: string; status: string; me?: { pushName?: string } | null }[] }) {
  const value = useSettings((s) => s.session);
  const save = useSettings((s) => s.save);
  const waWeb = useWaWeb((s) => s.sessions);
  const active = useWaWeb((s) => s.active);
  const setActive = useWaWeb((s) => s.setActive);
  const add = useWaWeb((s) => s.add);
  const dot = (status: string) =>
    status === "WORKING" ? "bg-emerald-500" : status === "STOPPED" ? "bg-neutral-400" : "bg-amber-400";
  const current = sessions.find((s) => s.name === value);
  const selected = active ? `waweb:${active}` : value;
  return (
    <label className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-sm">
      <span className={cn("w-2 h-2 rounded-full shrink-0", active ? "bg-wa" : dot(current?.status ?? ""))} />
      <select
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === WAWEB_NEW) add();
          else if (v.startsWith("waweb:")) setActive(v.slice(6));
          else {
            setActive(null);
            void save({ session: v });
          }
        }}
        className="flex-1 bg-transparent outline-none cursor-pointer min-w-0 truncate"
        title="Active session"
      >
        <optgroup label="WAHA">
          {!current && !active && <option value={value}>{value} (not found)</option>}
          {sessions.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.me?.pushName ? ` · ${s.me.pushName}` : ""} · {s.status}
            </option>
          ))}
        </optgroup>
        <optgroup label="WhatsApp Web">
          {waWeb.map((s) => (
            <option key={s.id} value={`waweb:${s.id}`}>
              {s.name}
            </option>
          ))}
          <option value={WAWEB_NEW}>＋ Add WhatsApp Web…</option>
        </optgroup>
      </select>
    </label>
  );
}

/** First word of the sender's push name for group previews ("Budi: …"). */
function senderShort(m: WAMessage) {
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  const name = d.Info?.PushName?.trim();
  if (name) return name.split(/\s+/)[0]!;
  const id = m.participant || m.from;
  return id ? displayId(id) : "";
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
  if (msg.documentMessage) return `📄 ${(msg.documentMessage as { fileName?: string }).fileName ?? "Document"}`;
  if (m.hasMedia) return "📎 Media";
  return "";
}

function ChatRowMenu({ chat, pos, onClose, onDelete, onArchive, onUnread, onPin, onMute, onLabels, pinned, muted, archived }: { chat: ChatOverview; pos: { x: number; y: number }; onClose: () => void; onDelete: () => void; onArchive: () => void; onUnread: () => void; onPin: () => void; onMute: () => void; onLabels: () => void; pinned: boolean; muted: boolean; archived: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const item = (label: string, fn: () => void, danger = false) => (
    <button onClick={() => { onClose(); fn(); }} className={cn("w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800", danger && "text-red-600")}>
      {label}
    </button>
  );
  return (
    <div ref={ref} style={{ left: Math.min(pos.x, window.innerWidth - 200), top: Math.min(pos.y, window.innerHeight - 220) }} className="fixed z-50 w-52 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1">
      <div className="px-3 py-1 text-[11px] text-neutral-500 truncate">{chat.name || displayId(chat.id)}</div>
      {item(pinned ? "Unpin" : "Pin to top", onPin)}
      {item(muted ? "Unmute notifications" : "Mute notifications", onMute)}
      {item("Labels…", onLabels)}
      {item("Mark as unread", onUnread)}
      {item(archived ? "Unarchive chat" : "Archive chat", onArchive)}
      {item("Delete chat…", onDelete, true)}
    </div>
  );
}

function ChatRow({
  chat,
  session,
  active,
  resolveName,
  onClick,
  onContextMenu,
}: {
  chat: ChatOverview;
  session: string;
  active: boolean;
  resolveName: MentionResolver;
  onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const name = chat.name || displayId(chat.id);
  const lm = chat.lastMessage;
  const counts = useUnread((s) => s.counts);
  const lastSeen = useUnread((s) => s.lastSeen);
  const unread = unreadFor({ counts, lastSeen }, session, chat.id, lm);
  const isPinned = useChatPrefs((s) => !!s.pinned[`${session}:${chat.id}`]);
  const isMuted = useChatPrefs((s) => !!s.muted[`${session}:${chat.id}`]);
  const { data: allLabels } = useLabels(session);
  const { data: lmap } = useLabelMap(session);
  const chatLabels = (lmap?.[chat.id] ?? []).map((id) => allLabels?.find((l) => l.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const kindLabel = lm ? previewKind(lm) : "";
  const body = lm?.body ? replaceMentions(stripWaMarkdown(lm.body), resolveName) : "";
  // Media with a caption → "📷 caption"; media without → "📷 Photo"; text → text.
  const content = body && kindLabel ? `${kindLabel.split(" ")[0]} ${body}` : body || kindLabel;
  const sender = lm && isGroup(chat.id) && !lm.fromMe ? senderShort(lm) : lm?.fromMe && isGroup(chat.id) ? "You" : "";
  const preview = sender ? `${sender}: ${content}` : content;
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
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
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {chatLabels.slice(0, 3).map((l) => <span key={l.id} title={l.name} className="w-2 h-2 rounded-full" style={{ background: l.colorHex || "#999" }} />)}
            {isMuted && <BellOff size={11} className="text-neutral-400" />}
            {isPinned && <Pin size={11} className="text-neutral-400" />}
            {lm && <span className="text-[11px] text-neutral-400">{formatTime(lm.timestamp)}</span>}
          </span>
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
  const myIds = useMemo(() => [me?.id, me?.lid, me?.jid].filter((x): x is string => !!x), [me]);
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
          if ((t.kind ?? "revoked") === "revoked") existing.revoked = true;
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
  useEffect(() => {
    markSeen(session, chatId);
    if (useSettings.getState().readReceipts === "always") requireClient().sendSeen(session, chatId).catch(() => {});
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
      // WAHA applies `limit` before filtering out hidden message types, so a page can be
      // shorter than `limit` while older messages still exist — only an empty page means the end.
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
      } else {
        setHasNewer(false);
      }
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
              <ErrorBoundary inline label="message">
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
                  onSender={(id) => setContactId(id)}
                />
              </ErrorBoundary>
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

function senderName(m: WAMessage) {
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  return d.Info?.PushName || displayId(m.participant || m.from) || "Unknown";
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
  onSender,
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
  onSender: (id: string) => void;
}) {
  const mine = m.fromMe;
  const { revoked, waiting } = m as WAMessage & { revoked?: boolean; waiting?: boolean };
  if (waiting) {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className="max-w-[70%] rounded-lg px-3 py-1.5 text-sm italic text-neutral-500 dark:text-neutral-400 border border-dashed border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/20" title="WhatsApp could not deliver the encryption key for this message to this session yet. It is retried automatically; the sender's phone has to be online.">
          {group && !mine && (
            <div className="text-[11px] font-semibold not-italic text-wa-dark dark:text-wa mb-0.5">{resolveName(m.participant || m.from) ?? senderName(m)}</div>
          )}
          ⏳ Waiting for this message. This may take a while.
          <div className="text-right text-[10px] not-italic mt-0.5">{formatTime(m.timestamp)}</div>
        </div>
      </div>
    );
  }
  if (revoked) {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className={cn("max-w-[70%] rounded-lg px-3 py-1.5 text-sm italic text-neutral-500 dark:text-neutral-400 border border-dashed", mine ? "border-wa-dark/40 bg-[#d9fdd3]/40 dark:bg-wa-teal/30" : "border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-800/60")}>
          {group && !mine && (
            <div className="text-[11px] font-semibold not-italic text-wa-dark dark:text-wa mb-0.5">{resolveName(m.participant || m.from) ?? senderName(m)}</div>
          )}
          🚫 {mine ? "You deleted this message" : "This message was deleted"}
          <div className="text-right text-[10px] not-italic mt-0.5">{formatTime(m.timestamp)}</div>
        </div>
      </div>
    );
  }
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
          <button
            onClick={() => onSender(m.participant || m.from)}
            className="block text-[11px] font-semibold text-wa-dark dark:text-wa mb-0.5 hover:underline text-left"
            title="View contact"
          >
            {resolveName(m.participant || m.from) ?? senderName(m)}
          </button>
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
        <PollView message={m} session={session} chatId={chatId} />
        {m.body && (
          <div className="break-words">
            <WaMarkdown text={m.body} mentions={resolveName} />
          </div>
        )}
        <TranslationView id={m.id} />
        <ImageNoteView id={m.id} />
        {m.body && !m.hasMedia && <LinkPreviewCard message={m} />}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-300/70">
          {isEdited(m) && <span className="italic">edited</span>}
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

function TranslationView({ id }: { id: string }) {
  const t = useTranslations((s) => s.byMsg[id]);
  const clear = useTranslations((s) => s.clear);
  if (!t) return null;
  return (
    <div className="mt-1 rounded-md border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300 mb-0.5">
        <Languages size={10} /> {langName(t.target)}
        <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => clear(id)} title="Hide translation"><X size={10} /></button>
      </div>
      {t.loading && <span className="flex items-center gap-1 opacity-70"><Spinner size={10} className="animate-spin" /> translating…</span>}
      {t.error && <span className="text-red-600 selectable">{t.error}</span>}
      {t.text && <div className="whitespace-pre-wrap break-words selectable">{t.text}</div>}
    </div>
  );
}

/** AI description / OCR result under an image bubble. */
function ImageNoteView({ id }: { id: string }) {
  const n = useImageNotes((s) => s.byMsg[id]);
  const clear = useImageNotes((s) => s.clear);
  if (!n) return null;
  return (
    <div className="mt-1 rounded-md border-l-2 border-violet-400 bg-violet-50/70 dark:bg-violet-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-violet-700 dark:text-violet-300 mb-0.5">
        {n.kind === "ocr" ? <ScanText size={10} /> : <Sparkles size={10} />} {n.kind === "ocr" ? "Extracted text" : "Description"}
        {n.text && <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => void navigator.clipboard.writeText(n.text!)} title="Copy"><Copy size={10} /></button>}
        <button className={cn("opacity-60 hover:opacity-100", !n.text && "ml-auto")} onClick={() => clear(id)} title="Hide"><X size={10} /></button>
      </div>
      {n.loading && <span className="flex items-center gap-1 opacity-70"><Spinner size={10} className="animate-spin" /> {n.kind === "ocr" ? "reading text…" : "looking at the image…"}</span>}
      {n.error && <span className="text-red-600 selectable">{n.error}</span>}
      {n.text && <div className="whitespace-pre-wrap break-words selectable">{n.text}</div>}
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

function PollView({ message: m, session, chatId }: { message: WAMessage; session: string; chatId: string }) {
  const msg = (m._data as { Message?: Record<string, { name?: string; options?: { optionName: string }[]; selectableOptionsCount?: number }> } | undefined)?.Message;
  const poll = msg?.pollCreationMessageV3 ?? msg?.pollCreationMessage ?? msg?.pollCreationMessageV2;
  const votes = usePolls((s) => s.byPoll[bareId(m.id)]);
  const setOwn = usePolls((s) => s.setOwn);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!poll) return null;
  const multiple = poll.selectableOptionsCount === 0;
  const mine = votes?.me ?? [];
  const tally = new Map<string, number>();
  for (const opts of Object.values(votes ?? {})) for (const o of opts) tally.set(o, (tally.get(o) ?? 0) + 1);
  const total = Object.keys(votes ?? {}).length;

  const vote = async (option: string) => {
    const next = multiple ? (mine.includes(option) ? mine.filter((x) => x !== option) : [...mine, option]) : mine.includes(option) ? [] : [option];
    setBusy(true);
    setErr(null);
    try {
      await requireClient().votePoll(session, chatId, m.id, next);
      setOwn(m.id, next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-1 space-y-1 min-w-[200px]">
      <div className="font-medium">📊 {poll.name}</div>
      {poll.options?.map((o, i) => {
        const n = tally.get(o.optionName) ?? 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const chosen = mine.includes(o.optionName);
        return (
          <button
            key={i}
            disabled={busy}
            onClick={() => vote(o.optionName)}
            className={cn("relative w-full overflow-hidden rounded-md bg-black/5 dark:bg-white/10 px-2 py-1 text-xs text-left", chosen && "ring-1 ring-wa-dark")}
          >
            <span className="absolute inset-y-0 left-0 bg-wa/30" style={{ width: `${pct}%` }} />
            <span className="relative flex items-center gap-1.5">
              <span className={cn("w-3 h-3 rounded-full border", chosen ? "bg-wa-dark border-wa-dark" : "border-neutral-400")} />
              <span className="flex-1">{o.optionName}</span>
              <span className="opacity-70">{n}</span>
            </span>
          </button>
        );
      })}
      <div className="text-[10px] opacity-60">
        {total} vote{total === 1 ? "" : "s"} · {multiple ? "multiple answers" : "single answer"} · counted from live events
      </div>
      {err && <div className="text-[10px] text-red-600 selectable">{err}</div>}
    </div>
  );
}

/** WhatsApp marks edits via Info.Edit ("1") or an editedMessage wrapper; our own edits set `edited`. */
function isEdited(m: WAMessage & { edited?: boolean }) {
  if (m.edited) return true;
  const d = m._data as { Info?: { Edit?: string }; Message?: Record<string, unknown> } | undefined;
  return d?.Info?.Edit === "1" || !!d?.Message?.editedMessage;
}

function TranslateDraftButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const target = useSettings((s) => s.aiComposeTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = aiConfigured();
  return (
    <div className="relative">
      <Button
        variant="ghost"
        disabled={!text.trim() || busy || !ready}
        title={ready ? `Translate draft to ${langName(target)} (⌘⇧T)` : "Set up AI in Settings to translate"}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            onResult(await translate(text, target));
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setTimeout(() => setErr(null), 4000);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={18} className="animate-spin" /> : <Languages size={18} />}
      </Button>
      {err && <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">{err}</div>}
    </div>
  );
}

/** ✨ menu in the composer: rewrite the draft (fix / formal / casual / …) with one-step undo. */
function WriteAssistButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<RewriteMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const ready = aiConfigured();
  useEffect(() => { if (!text) setUndo(null); }, [text]); // draft sent or cleared → nothing to undo
  const run = async (mode: RewriteMode) => {
    setOpen(false);
    setBusy(mode);
    setErr(null);
    try {
      const before = text;
      const out = await rewriteDraft(text, mode);
      if (out) { setUndo(before); onResult(out); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTimeout(() => setErr(null), 4000);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative">
      <Button
        variant="ghost"
        disabled={(!text.trim() && !undo) || !!busy || !ready}
        title={ready ? "Writing assistant" : "Set up AI in Settings to use the writing assistant"}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <Spinner size={18} className="animate-spin" /> : <WandSparkles size={18} />}
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-30 w-52 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-sm" onMouseLeave={() => setOpen(false)}>
          {undo && (
            <>
              <button onClick={() => { onResult(undo); setUndo(null); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Undo2 size={14} /> Undo last rewrite
              </button>
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
            </>
          )}
          {REWRITE_MODES.map(([id, label]) => (
            <button key={id} disabled={!text.trim()} onClick={() => void run(id)} className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40">
              {label}
            </button>
          ))}
        </div>
      )}
      {err && <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">{err}</div>}
    </div>
  );
}

/** Suggested replies above the composer. Manual trigger (one request per click); cleared when a new message arrives. */
function SmartReplies({ chatId, chatName, recent, resolveName, onPick }: { chatId: string; chatName: string; recent: WAMessage[]; resolveName: MentionResolver; onPick: (t: string) => void }) {
  const [items, setItems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = recent[recent.length - 1];
  const lastId = last?.id;
  useEffect(() => { setItems(null); setErr(null); }, [chatId, lastId]);
  if (!aiConfigured() || !last || last.fromMe) return null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const usable = recent.filter((m) => !(m as WAMessage & { waiting?: boolean }).waiting && (m.body || m.hasMedia));
      setItems(await smartReplies(transcript(usable, resolveName), { chatName, isGroup: isGroup(chatId) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {items === null ? (
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-neutral-500 hover:text-wa-dark hover:border-wa-dark disabled:opacity-50">
          {busy ? <Spinner size={12} className="animate-spin" /> : <Sparkles size={12} />} Suggest replies
        </button>
      ) : (
        <>
          {items.map((t, i) => (
            <button key={i} onClick={() => onPick(t)} title="Insert into composer" className="max-w-[320px] truncate rounded-full bg-wa/15 dark:bg-wa/20 px-3 py-1 text-left hover:bg-wa/30">
              {t}
            </button>
          ))}
          <button onClick={run} disabled={busy} title="Regenerate" className="p-1 text-neutral-500 hover:text-wa-dark disabled:opacity-50">
            {busy ? <Spinner size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button onClick={() => setItems(null)} title="Dismiss" className="p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><X size={12} /></button>
        </>
      )}
      {err && <span className="text-red-600 selectable">{err}</span>}
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
  onEditLast,
  recent,
}: {
  session: string;
  chatId: string;
  replyTo: WAMessage | null;
  onClearReply: () => void;
  editing: WAMessage | null;
  onClearEdit: () => void;
  resolveName: MentionResolver;
  myIds: string[];
  onEditLast: () => void;
  /** Newest loaded messages (oldest first) for reply suggestions. */
  recent: WAMessage[];
}) {
  const draftKey = `${session}:${chatId}`;
  const setDraft = useDrafts((s) => s.set);
  const [text, setTextRaw] = useState(() => useDrafts.getState().drafts[draftKey] ?? "");
  const setText = (v: string) => {
    setTextRaw(v);
    setDraft(draftKey, v);
  };
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const autoOut = useChatPrefs((s) => s.autoTranslate[`${session}:${chatId}`]?.out); // NB: chatPrefs keys are session:chatId
  const [dialog, setDialog] = useState<AttachKind | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [slash, setSlash] = useState<string | null>(null); // "/query" at the start of the composer
  const { data: chatsForCtx } = useChats(session);
  const chatCtx = useMemo(() => {
    const c = chatsForCtx?.find((x) => x.id === chatId);
    return { name: c?.name ?? displayId(chatId), phone: chatId.endsWith("@c.us") ? `+${chatId.split("@")[0]}` : "" };
  }, [chatsForCtx, chatId]);
  const mentionIds = useRef<Map<string, string>>(new Map()); // "@phone" in text → id
  const { data: groupInfo } = useGroupInfo(session, chatId);
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!isGroup(chatId)) return [];
    return (groupInfo?.Participants ?? [])
      .map((p) => {
        const phone = p.PhoneNumber?.split("@")[0] ?? "";
        if (!phone) return null;
        return { id: `${phone}@c.us`, phone, name: resolveName(p.JID) ?? resolveName(`${phone}@c.us`) ?? p.DisplayName ?? `+${phone}` };
      })
      .filter((x): x is MentionCandidate => !!x)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groupInfo, chatId, resolveName]);

  const chipTable = useMemo(() => new Map(mentionCandidates.map((c) => [c.phone, c])), [mentionCandidates]);
  const draggingRef = useRef(0);
  const [dragging, setDragging] = useState(false);
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
    if (!useSettings.getState().sendTyping) return;
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
          old?.map((m) => (m.id === editing.id ? { ...m, body: t, edited: true } : m)),
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
      receiptBeforeSend();
      let out = t;
      if (autoOut && aiConfigured()) {
        setTranslating(true);
        try {
          out = (await translate(t, autoOut)) || t;
        } finally {
          setTranslating(false);
        }
      }
      const mentions = [...out.matchAll(/@(\d{6,20})/g)].map((x) => chipTable.get(x[1]!)?.id ?? mentionIds.current.get(x[1]!)).filter((x): x is string => !!x);
      await send.mutateAsync({ text: out, replyTo: replyTo?.id, mentions: [...new Set(mentions)] });
      onClearReply();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setText(t);
    }
  };

  /** "Mark as read only when I reply": send the receipt right before our message goes out. */
  const receiptBeforeSend = () => {
    if (useSettings.getState().readReceipts === "on-reply") requireClient().sendSeen(session, chatId).catch(() => {});
  };

  /** Put a freshly sent message into the cache and refresh the chat list. */
  const appendSent = (msg: WAMessage) => {
    receiptBeforeSend();
    qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => (old ? [msg, ...old] : old));
    qc.invalidateQueries({ queryKey: qk.chats(session) });
  };

  const attach = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      receiptBeforeSend();
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
    <div
      className={cn("relative shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2", dragging && "ring-2 ring-inset ring-wa-dark")}
      onDragEnter={(e) => { e.preventDefault(); draggingRef.current++; setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { draggingRef.current--; if (draggingRef.current <= 0) { draggingRef.current = 0; setDragging(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        draggingRef.current = 0;
        setDragging(false);
        const f = [...e.dataTransfer.files][0];
        if (f) void attach(f);
      }}
    >
      {dragging && <div className="absolute inset-0 grid place-items-center bg-white/80 dark:bg-neutral-900/80 text-sm font-medium text-wa-dark z-10 pointer-events-none">Drop to send</div>}
      {slash !== null && (
        <QuickReplyPicker
          query={slash}
          ctx={chatCtx}
          onClose={() => setSlash(null)}
          onPick={(t) => {
            setText(t);
            setSlash(null);
            requestAnimationFrame(() => taRef.current?.focus());
          }}
        />
      )}
      {mention && (
        <MentionPicker
          query={mention.query}
          candidates={mentionCandidates}
          onClose={() => setMention(null)}
          onPick={(c) => {
            const before = text.slice(0, mention.start);
            const after = text.slice(mention.start + 1 + mention.query.length);
            const inserted = `@${c.phone} `;
            mentionIds.current.set(c.phone, c.id);
            setText(before + inserted + after);
            setMention(null);
            requestAnimationFrame(() => {
              const ta = taRef.current;
              if (!ta) return;
              ta.focus();
              ta.selectionStart = ta.selectionEnd = before.length + inserted.length;
            });
          }}
        />
      )}
      {!editing && !text.trim() && (
        <SmartReplies chatId={chatId} chatName={chatCtx.name} recent={recent} resolveName={resolveName} onPick={(t) => { setText(t); requestAnimationFrame(() => taRef.current?.focus()); }} />
      )}
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
        <TranslateDraftButton text={text} onResult={(t) => setText(t)} />
        <WriteAssistButton text={text} onResult={(t) => setText(t)} />
        <EmojiButton
          onPick={(emoji) => {
            const ta = taRef.current;
            const start = ta?.selectionStart ?? text.length;
            const end = ta?.selectionEnd ?? text.length;
            const next = text.slice(0, start) + emoji + text.slice(end);
            setText(next);
            requestAnimationFrame(() => {
              if (!ta) return;
              ta.focus();
              ta.selectionStart = ta.selectionEnd = start + emoji.length;
            });
          }}
        />
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (v) noteTyping();
            // "@query" right before the caret → open the mention picker (groups only)
            const caret = e.target.selectionStart ?? v.length;
            const before = v.slice(0, caret);
            const m = before.match(/(?:^|\s)@([^\s@]*)$/);
            setMention(m && mentionCandidates.length ? { start: caret - m[1]!.length - 1, query: m[1]! } : null);
            const sl = v.match(/^\/(\S*)$/);
            setSlash(sl ? sl[1]! : null);
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files][0];
            if (f) {
              e.preventDefault();
              void attach(f);
            }
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
            if (e.key === "ArrowUp" && !text && !editing) {
              e.preventDefault();
              onEditLast();
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
        <Button onClick={submit} disabled={!text.trim() || send.isPending || translating} title={autoOut ? `Send (translated to ${langName(autoOut)})` : "Send"}>
          {send.isPending || translating ? <Loader2 size={16} className="animate-spin" /> : autoOut ? <Languages size={16} /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
}

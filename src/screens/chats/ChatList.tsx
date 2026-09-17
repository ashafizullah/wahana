import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BellOff, Loader2, Megaphone, Pin, Search, SquarePen, Users } from "lucide-react";
import { useChats, useSessions, qk } from "@/api/queries";
import { requireClient, useSettings } from "@/store/settings";
import { Avatar, Button } from "@/components/ui";
import { NewChatDialog } from "@/components/NewChatDialog";
import { useNameResolver } from "@/realtime/useNames";
import { confirm } from "@/components/Confirm";
import { useChatPrefs } from "@/store/chatPrefs";
import { LabelsDialog, useLabelMap, useLabels } from "@/components/LabelsDialog";
import type { MentionResolver } from "@/lib/waMarkdown";
import { stripWaMarkdown, replaceMentions } from "@/lib/waMarkdown";
import type { ChatOverview, WAMessage } from "@/api/types";
import { cn, displayId, formatTime, isChannel, isGroup, errMsg } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { chatKey, unreadFor, useUnread } from "@/store/unread";
import { useWaWeb } from "@/store/waWeb";
import { AckIcon } from "@/screens/chats/MessageBubble";

// ── Chat list ────────────────────────────────────────────────────────────

export function ChatList({
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
    <div
      style={{ width }}
      className="shrink-0 flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
    >
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
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium outline-none max-w-[96px] truncate",
                labelFilter ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
              )}
              title="Filter by label"
            >
              <option value="">Label</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {newChat && <NewChatDialog session={session} onPick={onSelect} onClose={() => setNewChat(false)} />}
      {labelsFor && (
        <LabelsDialog
          session={session}
          chatId={labelsFor.id}
          chatName={labelsFor.name || displayId(labelsFor.id)}
          onClose={() => setLabelsFor(null)}
        />
      )}
      {rowMenu && (
        <ChatRowMenu
          chat={rowMenu.chat}
          pos={rowMenu}
          onClose={() => setRowMenu(null)}
          onDelete={async () => {
            const name = rowMenu.chat.name || displayId(rowMenu.chat.id);
            const ok = await confirm({
              title: `Delete chat with ${name}?`,
              message: "Removes the conversation and its messages from this WhatsApp account (all your devices). This cannot be undone.",
              confirmLabel: "Delete chat",
              danger: true,
            });
            if (!ok) return;
            try {
              await requireClient().deleteChat(session, rowMenu.chat.id);
              if (selected === rowMenu.chat.id) onSelect("");
              qc.invalidateQueries({ queryKey: qk.chats(session) });
            } catch (e) {
              await confirm({ title: "Couldn't delete chat", message: errMsg(e), confirmLabel: "OK" });
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
              await confirm({
                title: wasArchived ? "Couldn't unarchive chat" : "Couldn't archive chat",
                message: errMsg(e),
                confirmLabel: "OK",
              });
            }
          }}
          onUnread={async () => {
            try {
              await requireClient().markUnread(session, rowMenu.chat.id);
            } catch (e) {
              await confirm({ title: "Couldn't mark unread", message: errMsg(e), confirmLabel: "OK" });
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
              <div key={c.id} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
                <ChatRow
                  chat={c}
                  session={session}
                  active={c.id === selected}
                  resolveName={resolveName}
                  onClick={() => onSelect(c.id)}
                  onContextMenu={(x, y) => setRowMenu({ chat: c, x, y })}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProfilePicker() {
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
export function SessionPicker({ sessions }: { sessions: { name: string; status: string; me?: { pushName?: string } | null }[] }) {
  const value = useSettings((s) => s.session);
  const save = useSettings((s) => s.save);
  const waWeb = useWaWeb((s) => s.sessions);
  const active = useWaWeb((s) => s.active);
  const setActive = useWaWeb((s) => s.setActive);
  const add = useWaWeb((s) => s.add);
  const isolated = useWaWeb((s) => s.isolated);
  const waWebUnread = useWaWeb((s) => s.unread);
  const canAddWaWeb = isolated || waWeb.length === 0;
  const dot = (status: string) => (status === "WORKING" ? "bg-emerald-500" : status === "STOPPED" ? "bg-neutral-400" : "bg-amber-400");
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
              {waWebUnread[s.id] ? ` · ${waWebUnread[s.id]} unread` : ""}
            </option>
          ))}
          <option value={WAWEB_NEW} disabled={!canAddWaWeb}>
            {canAddWaWeb ? "＋ Add WhatsApp Web…" : "＋ Add WhatsApp Web… (needs macOS 14 for a 2nd account)"}
          </option>
        </optgroup>
      </select>
    </label>
  );
}

/** First word of the sender's push name for group previews ("Budi: …"). */
export function senderShort(m: WAMessage) {
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  const name = d.Info?.PushName?.trim();
  if (name) return name.split(/\s+/)[0]!;
  const id = m.participant || m.from;
  return id ? displayId(id) : "";
}

/** Short label for body-less messages (media, polls, contacts, locations…). */
export function previewKind(m: WAMessage) {
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

function ChatRowMenu({
  chat,
  pos,
  onClose,
  onDelete,
  onArchive,
  onUnread,
  onPin,
  onMute,
  onLabels,
  pinned,
  muted,
  archived,
}: {
  chat: ChatOverview;
  pos: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnread: () => void;
  onPin: () => void;
  onMute: () => void;
  onLabels: () => void;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
}) {
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
    <button
      onClick={() => {
        onClose();
        fn();
      }}
      className={cn("w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800", danger && "text-red-600")}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      style={{ left: Math.min(pos.x, window.innerWidth - 200), top: Math.min(pos.y, window.innerHeight - 220) }}
      className="fixed z-50 w-52 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1"
    >
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
  // Scalar selectors: one incoming message must not re-render every visible row.
  const rowKey = chatKey(session, chat.id);
  const count = useUnread((s) => s.counts[rowKey] ?? 0);
  const seen = useUnread((s) => s.lastSeen[rowKey]);
  const unread = unreadFor({ counts: { [rowKey]: count }, lastSeen: seen === undefined ? {} : { [rowKey]: seen } }, session, chat.id, lm);
  const isPinned = useChatPrefs((s) => !!s.pinned[`${session}:${chat.id}`]);
  const isMuted = useChatPrefs((s) => !!s.muted[`${session}:${chat.id}`]);
  const { data: allLabels } = useLabels(session);
  const { data: lmap } = useLabelMap(session);
  const chatLabels = (lmap?.[chat.id] ?? [])
    .map((id) => allLabels?.find((l) => l.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x);
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
            {chatLabels.slice(0, 3).map((l) => (
              <span key={l.id} title={l.name} className="w-2 h-2 rounded-full" style={{ background: l.colorHex || "#999" }} />
            ))}
            {isMuted && <BellOff size={11} className="text-neutral-400" />}
            {isPinned && <Pin size={11} className="text-neutral-400" />}
            {lm && <span className="text-[11px] text-neutral-400">{formatTime(lm.timestamp)}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn("text-xs truncate flex-1", unread ? "text-neutral-800 dark:text-neutral-100 font-medium" : "text-neutral-500")}
          >
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

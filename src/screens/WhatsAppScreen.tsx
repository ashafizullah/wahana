import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  BellOff,
  Languages,
  Loader2,
  Paperclip,
  Pencil,
  Search,
  Send,
  Sparkles,
  Users,
  Megaphone,
  Pin,
  Tag,
  Info,
  X,
  Reply,
  Trash2,
  CheckSquare,
  Plus,
  Check,
} from "lucide-react";
import { Avatar, Button, Input, Popover } from "@/components/ui";
import { TakeoverButton } from "@/components/TakeoverButton";
import { confirm } from "@/components/Confirm";
import { EmojiButton } from "@/components/EmojiPicker";
import { StickerButton } from "@/components/StickerPicker";
import { clipboardImage, nameClipboardFile, noteSticker } from "@/lib/stickers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResizeHandle, usePaneWidth } from "@/components/ResizeHandle";
import { LANGUAGES, aiConfigured, langName, translate } from "@/lib/ai";
import { formatBytes } from "@/lib/mediaCache";
import { cn, convKey, displayId, errMsg, formatDateDivider, formatTime, isChannel, isGroup } from "@/lib/utils";
import { WaMarkdown, stripWaMarkdown } from "@/lib/waMarkdown";
import { nativeWa, type NativeAccount, type NativeChat, type NativeLabel, type NativeMessage } from "@/lib/nativeWa";
import { TranslateDraftButton, WriteAssistButton } from "@/components/DraftAssist";
import { QuickReplyPicker } from "@/components/QuickReplyPicker";
import { LinkPreviewCard } from "@/components/LinkPreview";
import { AckIcon, ImageNoteView, TranslationView } from "@/components/MessageExtras";
import { useStoryJump } from "@/store/storyJump";
import { NativeMessageMenu, NativeSmartReplies, NativeSummaryModal, useNativeAutoTranslate } from "@/screens/whatsapp/NativeAi";
import { NativeMessageInfo } from "@/screens/whatsapp/NativeMessageInfo";
import { NativeFollowChannel } from "@/screens/whatsapp/NativeChannel";
import { NativeInfoPanel } from "@/screens/whatsapp/NativeInfoPanel";
import { usePicture } from "@/screens/whatsapp/usePicture";
import { useNativeTyping } from "@/screens/whatsapp/useNativeTyping";
import { TypingBubble } from "@/components/TypingBubble";
import { NativeMediaView, cacheSentMedia, saveNativeMedia } from "@/screens/whatsapp/NativeMediaView";
import { readReceiptsFor, sendTypingFor, useReadReceipts } from "@/store/settings";
import { nativeAccountKey, nativeChatKey } from "@/lib/account";
import { useDrafts } from "@/store/drafts";
import { Pairing } from "@/screens/whatsapp/Pairing";
import { NativeLabelsDialog, labelColorHex } from "@/screens/whatsapp/NativeLabelsDialog";
import { MUTE_FOREVER, isMutedUntil, useChatPrefs } from "@/store/chatPrefs";
import { MuteControl } from "@/components/MuteControl";
import { bareId, summarize, useReactions } from "@/store/reactions";
import { isPinned, useChatPins, usePins } from "@/store/pins";
import { PinBanner } from "@/components/PinBanner";
import { useRevoked } from "@/store/revoked";
import { useWhatsApp } from "@/store/whatsapp";

/**
 * Chat screen for a native WhatsApp account (the Rust client, no embedded WhatsApp Web).
 * Pairing happens in place: while the account waits for a scan, the conversation area
 * shows the QR code.
 *
 * History comes from the local store (see `whatsapp_db.rs`); attachments download on
 * demand; the AI tools live in `whatsapp/NativeAi`.
 */

/** Timestamps from the backend are milliseconds; the shared formatters take seconds. */
const secs = (ms: number) => Math.floor(ms / 1000);

/**
 * How WhatsApp itself labels a chat: a saved contact by its name; anyone else by their
 * number, with the name they gave themselves as "~name".
 */
function chatLabel(chat: NativeChat | undefined, chatId: string) {
  if (!chat) return { title: isChannel(chatId) ? displayId(chatId) : chatId.split("@")[0]!, pushName: null };
  if (chat.saved || !chat.phone) {
    // A channel with no name yet falls back to "Channel 123456", not its raw id.
    const unnamed = isChannel(chatId) && chat.name === chatId.split("@")[0];
    return { title: unnamed ? displayId(chatId) : chat.name, pushName: null };
  }
  return { title: chat.phone, pushName: chat.name !== chat.phone ? chat.name : null };
}

type Filter = "all" | "unread" | "groups" | "channels";

/** WhatsApp only accepts edits within this long after sending. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Messages read from the local history per page. */
const PAGE = 100;

export function WhatsAppScreen({ account, header }: { account: NativeAccount; header: React.ReactNode }) {
  const tick = useWhatsApp((s) => s.messageTick);
  const setOpenChat = useWhatsApp((s) => s.setOpenChat);
  const [listWidth, setListWidth] = usePaneWidth("chatList", 320, 240, 560);
  const [chats, setChats] = useState<NativeChat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A chat id belongs to one account: switching accounts drops the selection.
  useEffect(() => {
    setChatId(null);
    setError(null);
  }, [account.id]);

  useEffect(() => {
    setOpenChat(chatId ? { account: account.id, chat: chatId } : null);
    return () => setOpenChat(null);
  }, [account.id, chatId, setOpenChat]);

  useEffect(() => {
    let cancelled = false;
    nativeWa
      .chats(account.id)
      .then((list) => !cancelled && setChats(list))
      .catch((e) => setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [account.id, tick, account.unread]);

  // Mute state set on the phone (or another linked device) wins over the local copy.
  useEffect(() => {
    const prefs = useChatPrefs.getState();
    for (const c of chats) {
      if (c.mutedUntil == null) continue;
      const key = nativeChatKey(account.id, c.id);
      const local = prefs.muted[key];
      if (c.mutedUntil === 0) {
        if (isMutedUntil(local)) prefs.setMuted(key, null);
      } else if (local !== c.mutedUntil && !(c.mutedUntil === MUTE_FOREVER && isMutedUntil(local) && local <= 1)) {
        prefs.setMuted(key, c.mutedUntil);
      }
    }
  }, [account.id, chats]);

  // Whatever arrives in the chat on screen is read as it lands.
  const openUnread = chats.find((c) => c.id === chatId)?.unread ?? 0;
  useEffect(() => {
    if (!chatId || openUnread === 0) return;
    void nativeWa.markRead(account.id, chatId).catch((e) => setError(errMsg(e)));
    // Blue ticks to the sender only when the account is set to receipt on open.
    if (readReceiptsFor(nativeAccountKey(account.id)) === "always") void nativeWa.sendReceipt(account.id, chatId).catch(() => {});
  }, [account.id, chatId, openUnread]);

  const chat = chats.find((c) => c.id === chatId);

  return (
    <>
      <ChatList
        account={account}
        header={header}
        chats={chats}
        selected={chatId}
        onSelect={setChatId}
        onDeleted={(ids) => ids.includes(chatId ?? "") && setChatId(null)}
        error={error}
        width={listWidth}
      />
      <ResizeHandle onDrag={(dx) => setListWidth((w) => w + dx)} onReset={() => setListWidth(320)} />
      {account.status === "qr" ? (
        <Pairing accountId={account.id} />
      ) : chatId ? (
        <Conversation
          key={`${account.id}:${chatId}`}
          account={account}
          chatId={chatId}
          chat={chat}
          tick={tick}
          onOpenChat={(ids, draft) => {
            setDraft(draft ?? null);
            setChatId(ids.find((id) => chats.some((c) => c.id === id)) ?? ids[ids.length - 1]!);
          }}
          initialDraft={draft}
          onDraftUsed={() => setDraft(null)}
          onError={setError}
        />
      ) : (
        <Empty>{account.status === "starting" ? <Loader2 className="animate-spin" /> : "Select a chat"}</Empty>
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
  account,
  header,
  chats,
  selected,
  onSelect,
  onDeleted,
  error,
  width,
}: {
  account: NativeAccount;
  header: React.ReactNode;
  chats: NativeChat[];
  selected: string | null;
  onSelect: (id: string) => void;
  onDeleted: (ids: string[]) => void;
  error: string | null;
  width: number;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [labels, setLabels] = useState<NativeLabel[]>([]);
  const [labelMap, setLabelMap] = useState<Record<string, string[]>>({});
  const [menu, setMenu] = useState<{ chat: NativeChat; x: number; y: number } | null>(null);
  const [labelsFor, setLabelsFor] = useState<NativeChat | null>(null);
  const [relabel, setRelabel] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pinned = useChatPrefs((s) => s.pinned);
  const muted = useChatPrefs((s) => s.muted);
  const labelsTick = useWhatsApp((s) => s.labelsTick);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("wahana:focus-search", focus);
    return () => window.removeEventListener("wahana:focus-search", focus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([nativeWa.labels(account.id), nativeWa.labelMap(account.id)])
      .then(([all, map]) => {
        if (cancelled) return;
        setLabels(all);
        setLabelMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account.id, labelsTick, relabel]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = chats.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "groups" && !isGroup(c.id)) return false;
      if (filter === "channels" && !isChannel(c.id)) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.id.includes(needle) ||
        (c.phone ?? "").replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\0") ||
        c.lastText.toLowerCase().includes(needle)
      );
    });
    // Pinned chats float to the top (most recently pinned first), like WhatsApp.
    return [...list].sort((a, b) => (pinned[nativeChatKey(account.id, b.id)] ?? 0) - (pinned[nativeChatKey(account.id, a.id)] ?? 0));
  }, [chats, q, filter, pinned, account.id]);

  // Chats that vanish from the list (deleted elsewhere) drop out of the selection.
  useEffect(() => {
    setPicked((cur) => {
      const next = new Set([...cur].filter((id) => chats.some((c) => c.id === id)));
      return next.size === cur.size ? cur : next;
    });
  }, [chats]);
  useEffect(() => {
    setSelecting(false);
    setPicked(new Set());
  }, [account.id]);

  const exitSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const totalUnread = chats.filter((c) => c.unread > 0).length;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const markRead = () =>
    run(async () => {
      await nativeWa.markAllRead(account.id, picked.size ? [...picked] : undefined);
      exitSelect();
    });
  const deletePicked = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: ids.length === 1 ? "Delete this chat?" : `Delete ${ids.length} chats?`,
      message: "Removes the conversations and their messages from this account and its linked phone. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await nativeWa.deleteChats(account.id, ids);
      onDeleted(ids);
      exitSelect();
    });
  };

  return (
    <div
      style={{ width }}
      className="shrink-0 flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
    >
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        {header}
        {account.syncing != null && <div className="px-1 text-xs text-neutral-500">Syncing history… {account.syncing}%</div>}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key === "Enter" && shown[0]) onSelect(shown[0].id);
            }}
            placeholder="Search chats (⌘K)"
            className="w-full rounded-lg bg-neutral-100 dark:bg-neutral-800 pl-8 pr-3 py-1.5 text-sm outline-none"
          />
        </div>
        <div className="flex gap-1 items-center flex-wrap">
          {(["all", "unread", "groups", "channels"] as const).map((f) => (
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
          <span className="ml-auto flex items-center gap-1">
            {!selecting && filter === "channels" && (
              <button
                onClick={() => setFollowing(true)}
                title="Follow a channel from its link"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
              >
                <Plus size={12} /> Follow
              </button>
            )}
            {!selecting && totalUnread > 0 && (
              <button
                onClick={() => void markRead()}
                disabled={busy}
                title="Mark every chat as read"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-50"
              >
                <CheckCheck size={12} /> Read all
              </button>
            )}
            <button
              onClick={() => (selecting ? exitSelect() : setSelecting(true))}
              title="Select chats"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                selecting ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
              )}
            >
              <CheckSquare size={12} /> {selecting ? "Cancel" : "Select"}
            </button>
          </span>
        </div>
        {selecting && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-neutral-500 mr-auto">{picked.size} selected</span>
            <button
              className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((c) => c.id)))}
            >
              {picked.size === shown.length && shown.length > 0 ? "None" : "All"}
            </button>
            <button
              disabled={busy || picked.size === 0}
              onClick={() => void markRead()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              <CheckCheck size={13} /> Read
            </button>
            <button
              disabled={busy || picked.size === 0}
              onClick={() => void deletePicked()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </div>
      {(error || account.error || actionError) && (
        <div className="px-3 py-2 text-xs bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 selectable">
          {actionError ?? error ?? account.error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-4 text-xs text-neutral-500">
            {chats.length > 0
              ? "No chats match."
              : account.status === "working"
                ? "Your phone sends chat history only when a device is linked. If this account was linked before history support, log out and link it again to load your chats."
                : "No chats yet."}
          </div>
        ) : (
          shown.map((c) => {
            const key = nativeChatKey(account.id, c.id);
            const chips = (labelMap[c.id] ?? [])
              .map((lid) => labels.find((l) => l.id === lid))
              .filter((l): l is NativeLabel => !!l)
              .map((l) => ({ name: l.name, color: labelColorHex(l.color) }));
            return (
              <ChatRow
                key={c.id}
                chat={c}
                accountId={account.id}
                connected={account.status === "working"}
                active={!selecting && c.id === selected}
                pinned={!!pinned[key]}
                muted={isMutedUntil(muted[key])}
                chips={chips}
                selecting={selecting}
                checked={picked.has(c.id)}
                onClick={() => (selecting ? toggle(c.id) : onSelect(c.id))}
                onMenu={(e) => {
                  e.preventDefault();
                  if (selecting) return toggle(c.id);
                  setMenu({ chat: c, x: e.clientX, y: e.clientY });
                }}
              />
            );
          })
        )}
      </div>
      {following && <NativeFollowChannel accountId={account.id} onFollowed={(id) => onSelect(id)} onClose={() => setFollowing(false)} />}
      {menu && (
        <RowMenu
          accountId={account.id}
          chat={menu.chat}
          pinned={!!pinned[nativeChatKey(account.id, menu.chat.id)]}
          muted={muted[nativeChatKey(account.id, menu.chat.id)]}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onLabels={() => {
            setLabelsFor(menu.chat);
            setMenu(null);
          }}
        />
      )}
      {labelsFor && (
        <NativeLabelsDialog
          accountId={account.id}
          chatId={labelsFor.id}
          chatName={labelsFor.name}
          onChanged={() => setRelabel((t) => t + 1)}
          onClose={() => setLabelsFor(null)}
        />
      )}
    </div>
  );
}

/** Right-click menu on a native chat: pin, mute, labels. */
function RowMenu({
  accountId,
  chat,
  pinned,
  muted,
  x,
  y,
  onClose,
  onLabels,
}: {
  accountId: string;
  chat: NativeChat;
  pinned: boolean;
  muted: number | undefined;
  x: number;
  y: number;
  onClose: () => void;
  onLabels: () => void;
}) {
  const togglePref = useChatPrefs((s) => s.toggle);
  const setMuted = useChatPrefs((s) => s.setMuted);
  const key = nativeChatKey(accountId, chat.id);
  const item = "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <div
      className="fixed inset-0 z-40"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="absolute w-48 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-xs"
        style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 220) }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={item}
          onClick={() => {
            togglePref("pinned", key);
            void nativeWa.pinChat(accountId, chat.id, !pinned).catch(() => {});
            onClose();
          }}
        >
          <Pin size={13} /> {pinned ? "Unpin" : "Pin to top"}
        </button>
        <MuteControl
          className={item}
          until={muted}
          onSet={(until) => {
            setMuted(key, until);
            void nativeWa.muteChat(accountId, chat.id, until).catch(() => {});
            onClose();
          }}
        />
        <button className={item} onClick={onLabels}>
          <Tag size={13} /> Labels…
        </button>
      </div>
    </div>
  );
}

const ChatRow = memo(function ChatRow({
  chat,
  accountId,
  connected,
  active,
  pinned,
  muted,
  chips,
  selecting,
  checked,
  onClick,
  onMenu,
}: {
  chat: NativeChat;
  accountId: string;
  connected: boolean;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  chips: { name: string; color: string }[];
  selecting: boolean;
  checked: boolean;
  onClick: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const picture = usePicture(accountId, chat.id, connected);
  const group = isGroup(chat.id);
  const channel = isChannel(chat.id);
  const { title, pushName } = chatLabel(chat, chat.id);
  const body = stripWaMarkdown(chat.lastText);
  const sender = group ? (chat.lastFromMe ? "You" : chat.lastSender.split(/\s+/)[0]) : "";
  const preview = sender ? `${sender}: ${body}` : body;
  // An unsent draft replaces the preview, like WhatsApp, except in the chat being typed in.
  const draft = useDrafts((s) => (active ? "" : (s.drafts[nativeChatKey(accountId, chat.id)] ?? "")));
  return (
    <button
      onClick={onClick}
      onContextMenu={onMenu}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        (active || checked) && "bg-neutral-100 dark:bg-neutral-800",
      )}
    >
      {selecting && (
        <span
          className={cn(
            "shrink-0 w-4 h-4 rounded border grid place-items-center",
            checked ? "bg-wa border-wa text-white" : "border-neutral-400",
          )}
        >
          {checked && <Check size={12} />}
        </span>
      )}
      <Avatar src={picture} name={pushName ?? title} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {group ? (
            <Users size={12} className="text-neutral-400 shrink-0" />
          ) : channel ? (
            <Megaphone size={12} className="text-neutral-400 shrink-0" />
          ) : null}
          <span className="font-medium truncate shrink-0 max-w-[70%]">{title}</span>
          {pushName && <span className="text-[11px] text-neutral-400 truncate">~{pushName}</span>}
          {muted && <BellOff size={12} className="shrink-0 text-neutral-400" />}
          {pinned && <Pin size={12} className="shrink-0 text-neutral-400" />}
          {chat.lastTimestamp > 0 && (
            <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{formatTime(secs(chat.lastTimestamp))}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "text-xs truncate flex-1",
              chat.unread ? "text-neutral-800 dark:text-neutral-100 font-medium" : "text-neutral-500",
            )}
          >
            {draft ? (
              <>
                <span className="text-red-500 font-medium">Draft:</span>
                {draft}
              </>
            ) : (
              <>
                {chat.lastFromMe && <AckIcon ack={chat.lastAck} className="inline mr-1 -mt-0.5" />}
                {preview}
              </>
            )}
          </div>
          {chat.unread > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-wa text-[10px] font-bold text-white grid place-items-center">
              {chat.unread}
            </span>
          )}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {chips.slice(0, 3).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-300"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="truncate max-w-[80px]">{c.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
});

// ── Conversation ─────────────────────────────────────────────────────────

function Conversation({
  account,
  chatId,
  chat,
  tick,
  onOpenChat,
  initialDraft,
  onDraftUsed,
  onError,
}: {
  account: NativeAccount;
  chatId: string;
  chat: NativeChat | undefined;
  tick: number;
  /** Open a direct chat: candidate chat ids, best first, optionally with a draft to start the composer with. */
  onOpenChat: (ids: string[], draft?: string) => void;
  /** Text waiting for this chat's composer (a private reply), taken once. */
  initialDraft: string | null;
  onDraftUsed: () => void;
  onError: (e: string) => void;
}) {
  const [info, setInfo] = useState(false);
  /** A group member whose profile was opened from a bubble; replaces the chat's own info panel. */
  const [profileId, setProfileId] = useState<string | null>(null);
  const readMode = useReadReceipts(nativeAccountKey(account.id));
  const { title, pushName } = chatLabel(chat, chatId);
  const name = pushName ?? title;
  const prefsKey = convKey(account.id, chatId);
  const autoTranslate = useChatPrefs((s) => s.autoTranslate[prefsKey]);
  const [infoFor, setInfoFor] = useState<NativeMessage | null>(null);
  const [menu, setMenu] = useState<{ m: NativeMessage; pos: { x: number; y: number } } | null>(null);
  const [summary, setSummary] = useState(false);
  const [draftPick, setDraftPick] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<NativeMessage | null>(null);
  const [editing, setEditing] = useState<NativeMessage | null>(null);
  const [forward, setForward] = useState<NativeMessage | null>(null);
  const pins = usePins((s) => s.items);
  const [messages, setMessages] = useState<NativeMessage[]>([]);
  const [limit, setLimit] = useState(PAGE);
  /** Waiting for the phone to answer a request for older messages. */
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  /** Scroll position to restore after older messages are prepended. */
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const group = isGroup(chatId);
  const channel = isChannel(chatId);
  const connected = account.status === "working";
  /** Owners and admins of a channel can post, edit and delete; everyone else only reads. */
  const [canPost, setCanPost] = useState(false);
  useEffect(() => {
    setCanPost(false);
    if (!channel || !connected) return;
    let cancelled = false;
    nativeWa
      .chatInfo(account.id, chatId)
      .then((d) => !cancelled && setCanPost(d.type === "channel" && (d.role === "owner" || d.role === "admin")))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channel, connected, account.id, chatId]);
  /** Group admins can delete other people's messages for everyone. */
  const [amAdmin, setAmAdmin] = useState(false);
  useEffect(() => {
    setAmAdmin(false);
    if (!group || !connected) return;
    let cancelled = false;
    nativeWa
      .chatInfo(account.id, chatId)
      .then((d) => !cancelled && setAmAdmin(d.type === "group" && d.members.some((m) => m.isMe && m.admin)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [group, connected, account.id, chatId]);
  useEffect(() => {
    if (initialDraft == null) return;
    setDraftPick(initialDraft);
    onDraftUsed();
  }, [initialDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  const picture = usePicture(account.id, chatId, connected);
  const typists = Object.values(useNativeTyping(account.id, chatId, connected && !channel));
  const moreStored = messages.length >= limit;
  const chatPins = useChatPins(prefsKey);
  const [pinIdx, setPinIdx] = useState(0);
  /** Pinned message to scroll to once it is loaded. */
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    nativeWa
      .messages(account.id, chatId, limit)
      .then((list) => {
        if (cancelled) return;
        setMessages((prev) => {
          if (list.length > prev.length) setAsking(false);
          return list;
        });
      })
      .catch((e) => onError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [account.id, chatId, limit, tick, onError]);

  // The phone may not answer at all (e.g. it is offline); don't spin forever.
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 20_000);
    return () => clearTimeout(timer);
  }, [asking]);

  // Keep the view where it was when older messages land on top; otherwise follow new
  // messages while scrolled to the bottom.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typists.length]);

  // Scroll to a pinned message, paging in stored history until it shows up.
  useEffect(() => {
    if (!jumpTo) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(jumpTo)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(jumpTo);
      setJumpTo(null);
    } else if (moreStored) {
      atBottom.current = false;
      setLimit((l) => l + PAGE);
    } else {
      setJumpTo(null);
      onError("That message isn't stored yet. Load older messages from your phone first.");
    }
  }, [jumpTo, messages, moreStored, onError]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);

  useNativeAutoTranslate(messages, autoTranslate?.in);
  const onMenu = useCallback((m: NativeMessage, pos: { x: number; y: number }) => setMenu({ m, pos }), []);

  // A reply, an edit, or a forward does not survive a chat switch.
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setForward(null);
    setPinIdx(0);
    setJumpTo(null);
  }, [chatId]);

  const deleteMessage = async (m: NativeMessage) => {
    const choice = await confirm({
      title: "Delete message?",
      choices: [
        {
          id: "everyone",
          label: "Delete for everyone",
          hint: m.fromMe
            ? "Removes it from the chat for all participants."
            : "Removes it from the chat for all participants, as a group admin.",
          danger: true,
        },
      ],
    });
    if (choice !== "everyone") return;
    try {
      await nativeWa.deleteMessage(account.id, chatId, m.id);
    } catch (e) {
      onError(errMsg(e));
    }
  };

  const deleteForMe = async (m: NativeMessage) => {
    try {
      await nativeWa.deleteLocal(account.id, chatId, m.id);
      setMessages((list) => list.filter((x) => x.id !== m.id));
    } catch (e) {
      onError(errMsg(e));
    }
  };

  const senderChatIds = (m: NativeMessage) => (m.senderPhone ? [`${m.senderPhone.replace(/\D/g, "")}@s.whatsapp.net`] : null);

  /** Pin for `secs`, or unpin when `secs` is omitted. */
  const pinMessage = async (m: NativeMessage, secs?: number) => {
    const on = secs !== undefined;
    try {
      await nativeWa.pinMessage(account.id, chatId, m.id, on, secs);
      usePins.getState().set(prefsKey, m.id, on ? Date.now() + secs * 1000 : 0);
    } catch (e) {
      onError(errMsg(e));
    }
  };

  // A channel's history lives on the server: fetch the latest page (with reaction totals)
  // on open and every minute while it stays open.
  useEffect(() => {
    if (!channel || !connected) return;
    const sync = () => nativeWa.channelSync(account.id, chatId, false).catch(() => {});
    void sync();
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, [channel, connected, account.id, chatId]);

  const loadOlder = () => {
    const el = listRef.current;
    anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    setLimit((l) => l + PAGE);
    if (moreStored) return;
    setAsking(true);
    if (channel) {
      nativeWa
        .channelSync(account.id, chatId, true)
        .then((n) => {
          // Nothing newly stored means the start of the channel: stop spinning.
          if (n === 0) setAsking(false);
        })
        .catch((e) => {
          setAsking(false);
          onError(errMsg(e));
        });
      return;
    }
    nativeWa.loadOlder(account.id, chatId).catch((e) => {
      setAsking(false);
      onError(errMsg(e));
    });
  };

  return (
    <>
      <div className="flex-1 min-w-0 flex flex-col bg-[#efeae2] dark:bg-neutral-950">
        <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
          <button
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
            onClick={() => {
              setProfileId(null);
              setInfo((v) => !v);
            }}
            title={group ? "Group info" : channel ? "Channel info" : "Contact info"}
          >
            <Avatar src={picture} name={name} size={36} />
            <div className="min-w-0">
              <div className="font-medium truncate">{title}</div>
              <div className="text-xs truncate text-neutral-500">
                {group
                  ? "Group · click for members"
                  : channel
                    ? "Channel · read-only"
                    : pushName
                      ? `~${pushName}`
                      : chat?.saved && chat.phone
                        ? chat.phone
                        : "Contact"}
              </div>
            </div>
          </button>
          {readMode === "manual" && !channel && <NativeReadReceiptButton accountId={account.id} chatId={chatId} messages={messages} />}
          {!channel && <TakeoverButton account={nativeAccountKey(account.id)} chatId={chatId} name={title} />}
          <AutoTranslateButton prefsKey={prefsKey} />
          {aiConfigured() && (
            <Button variant="ghost" size="sm" onClick={() => setSummary(true)} title="Summarize with AI">
              <Sparkles size={16} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInfo((v) => !v)}
            title="Info"
            className={cn(info && "text-wa-dark dark:text-wa")}
          >
            <Info size={16} />
          </Button>
        </header>

        {chatPins.length > 0 &&
          (() => {
            const index = pinIdx % chatPins.length;
            const id = chatPins[index]!;
            const m = messages.find((x) => bareId(x.id) === id);
            return (
              <PinBanner
                key={id}
                count={chatPins.length}
                index={index}
                who={m && (m.fromMe ? "You" : m.senderName || m.senderPhone || undefined)}
                text={m && (stripWaMarkdown(m.body) || "📎 Media")}
                onJump={() => {
                  setJumpTo(id);
                  // Like WhatsApp: each click moves on to the next (older) pin.
                  setPinIdx((i) => (i + 1) % chatPins.length);
                }}
                onUnpin={async () => {
                  await nativeWa.pinMessage(account.id, chatId, m?.id ?? id, false);
                  usePins.getState().set(prefsKey, id, 0);
                }}
              />
            );
          })()}

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-6 py-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            // Stored pages load as you scroll up; asking the phone stays an explicit click.
            if (el.scrollTop < 40 && moreStored && !anchor.current) loadOlder();
          }}
        >
          <div className="flex justify-center my-2 min-h-6">
            {moreStored ? (
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            ) : asking ? (
              <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <Loader2 size={12} className="animate-spin" /> {channel ? "Loading older posts…" : "Asking your phone for older messages…"}
              </span>
            ) : connected && messages.length > 0 ? (
              <button
                onClick={loadOlder}
                className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-wa-dark dark:text-wa shadow-sm hover:bg-white dark:hover:bg-neutral-700"
              >
                {channel ? "Load older posts" : "Load older messages from your phone"}
              </button>
            ) : messages.length === 0 ? (
              <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                No messages stored for this chat yet
              </span>
            ) : null}
          </div>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            // Photos sent together are one bubble, drawn by the first of them.
            const inAlbum = (a: NativeMessage | undefined, b: NativeMessage | undefined) =>
              !!a && !!b && !!a.albumId && a.albumId === b.albumId && !!a.media && a.fromMe === b.fromMe && a.senderName === b.senderName;
            if (inAlbum(prev, m)) return <div key={m.id} data-msg={bareId(m.id)} />;
            let album: NativeMessage[] | undefined;
            if (m.albumId && m.media) {
              album = [m];
              while (inAlbum(m, messages[i + album.length])) album.push(messages[i + album.length]!);
              if (album.length < 2) album = undefined;
            }
            const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
            const showSender = group && !m.fromMe && (newDay || prev?.fromMe || prev?.senderName !== m.senderName);
            const next = messages[i + (album?.length ?? 1)];
            const showAvatar =
              !m.fromMe &&
              group &&
              (!next ||
                next.fromMe ||
                new Date(next.timestamp).toDateString() !== new Date(m.timestamp).toDateString() ||
                next.senderName !== m.senderName);
            return (
              <div
                key={m.id}
                data-msg={bareId(m.id)}
                className={cn("pb-1 rounded transition-colors duration-500", flash === bareId(m.id) && "bg-wa/25")}
              >
                {newDay && (
                  <div className="flex justify-center my-3">
                    <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                      {formatDateDivider(secs(m.timestamp))}
                    </span>
                  </div>
                )}
                <ErrorBoundary inline label="message">
                  <Bubble
                    accountId={account.id}
                    connected={connected}
                    message={m}
                    album={album}
                    showSender={showSender}
                    avatar={!group ? "none" : showAvatar ? "show" : "space"}
                    avatarChatId={m.senderPhone ? `${m.senderPhone.replace(/\D/g, "")}@s.whatsapp.net` : null}
                    pinned={isPinned(pins, prefsKey, m.id)}
                    onMenu={onMenu}
                    onJumpTo={setJumpTo}
                    onProfile={setProfileId}
                  />
                </ErrorBoundary>
              </div>
            );
          })}
          {typists.map((t, i) => (
            <TypingBubble key={i} who={group ? (t.name ?? undefined) : undefined} recording={t.recording} />
          ))}
        </div>

        {channel && !canPost ? (
          <div className="shrink-0 flex items-center justify-center gap-2 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 px-4 py-3 text-xs text-neutral-500">
            <Megaphone size={14} /> Channels are read-only — only the channel can post.
          </div>
        ) : (
          <Composer
            account={account}
            chatId={chatId}
            chatName={name}
            messages={messages}
            autoOut={autoTranslate?.out}
            picked={draftPick}
            onPicked={() => setDraftPick(null)}
            onPick={setDraftPick}
            onError={onError}
            replyTo={replyTo}
            editing={editing}
            onCancelReply={() => setReplyTo(null)}
            onCancelEdit={() => setEditing(null)}
          />
        )}
        {menu && (
          <NativeMessageMenu
            accountId={account.id}
            message={menu.m}
            pos={menu.pos}
            pinned={isPinned(pins, prefsKey, menu.m.id)}
            onSave={() => saveNativeMedia(account.id, menu.m).catch((e) => onError(errMsg(e)))}
            onReply={
              channel || menu.m.revokedAt
                ? undefined
                : () => {
                    setEditing(null);
                    setReplyTo(menu.m);
                  }
            }
            onEdit={
              // Only plain text can be edited (a caption edit needs the media message), and
              // only within WhatsApp's edit window.
              (!channel || canPost) &&
              !menu.m.revokedAt &&
              menu.m.fromMe &&
              menu.m.kind === "text" &&
              Date.now() - menu.m.timestamp < EDIT_WINDOW_MS
                ? () => {
                    setReplyTo(null);
                    setEditing(menu.m);
                  }
                : undefined
            }
            onDelete={
              (!channel || canPost) && !menu.m.revokedAt && (menu.m.fromMe || (group && amAdmin))
                ? () => void deleteMessage(menu.m)
                : undefined
            }
            onDeleteLocal={channel ? undefined : () => void deleteForMe(menu.m)}
            onChat={group && !menu.m.fromMe && senderChatIds(menu.m) ? () => onOpenChat(senderChatIds(menu.m)!) : undefined}
            onReplyPrivately={
              group && !menu.m.fromMe && !menu.m.revokedAt && senderChatIds(menu.m)
                ? () => onOpenChat(senderChatIds(menu.m)!, quoteForPrivateReply(menu.m))
                : undefined
            }
            onPin={channel || menu.m.revokedAt ? undefined : (secs) => void pinMessage(menu.m, secs)}
            onForward={menu.m.revokedAt ? undefined : () => setForward(menu.m)}
            onInfo={menu.m.fromMe && !channel ? () => setInfoFor(menu.m) : undefined}
            onClose={() => setMenu(null)}
          />
        )}
        {infoFor && <NativeMessageInfo accountId={account.id} message={infoFor} onClose={() => setInfoFor(null)} />}
        {forward && (
          <NativeForwardDialog
            accountId={account.id}
            fromChatId={chatId}
            message={forward}
            onClose={() => setForward(null)}
            onError={onError}
          />
        )}
        {summary && (
          <NativeSummaryModal
            accountId={account.id}
            chatKey={prefsKey}
            chatId={chatId}
            chatName={name}
            messages={messages}
            canLoadOlder={moreStored || connected}
            onLoadOlder={loadOlder}
            onClose={() => setSummary(false)}
          />
        )}
      </div>
      {(profileId || info) && (
        <NativeInfoPanel
          key={profileId ?? chatId}
          accountId={account.id}
          chatId={profileId ?? chatId}
          connected={connected}
          picture={profileId ? null : picture}
          onOpenChat={onOpenChat}
          onClose={() => {
            setProfileId(null);
            setInfo(false);
          }}
        />
      )}
    </>
  );
}

/** "Manually" read-receipt mode: sends the blue ticks for this chat when clicked. */
function NativeReadReceiptButton({ accountId, chatId, messages }: { accountId: string; chatId: string; messages: NativeMessage[] }) {
  const [sentFor, setSentFor] = useState<string | null>(null); // id of the last incoming message we've acknowledged
  const lastIn = [...messages].reverse().find((m) => !m.fromMe);
  const pending = !!lastIn && sentFor !== lastIn.id;
  return (
    <Button
      variant={pending ? "primary" : "ghost"}
      size="sm"
      title={pending ? "Send read receipt (blue ticks) for this chat" : "Read receipt already sent"}
      disabled={!pending}
      onClick={async () => {
        try {
          await nativeWa.sendReceipt(accountId, chatId);
          setSentFor(lastIn!.id);
        } catch (e) {
          await confirm({ title: "Couldn't send read receipt", message: errMsg(e), confirmLabel: "OK" });
        }
      }}
    >
      <CheckCheck size={16} className={pending ? "" : "text-sky-500"} />
    </Button>
  );
}

/** Per-chat auto-translate: incoming shown in one language, your messages sent in another. */
function AutoTranslateButton({ prefsKey }: { prefsKey: string }) {
  const value = useChatPrefs((s) => s.autoTranslate[prefsKey]);
  const setAutoTranslate = useChatPrefs((s) => s.setAutoTranslate);
  const [open, setOpen] = useState(false);
  if (!aiConfigured()) return null;
  const select = (label: string, which: "in" | "out") => (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      <select
        value={value?.[which] ?? ""}
        onChange={(e) => setAutoTranslate(prefsKey, { [which]: e.target.value || undefined })}
        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm outline-none"
      >
        <option value="">Off</option>
        {LANGUAGES.map(([c, n]) => (
          <option key={c} value={c}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  const on = value?.in || value?.out;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      className="p-3 space-y-2 w-60"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          title={on ? `Auto-translate on${value?.in ? ` (incoming → ${langName(value.in)})` : ""}` : "Auto-translate"}
          className={cn(on && "text-wa-dark dark:text-wa")}
        >
          <Languages size={16} />
        </Button>
      }
    >
      <div className="text-xs font-medium">Auto-translate this chat</div>
      {select("Show incoming messages in", "in")}
      {select("Send my messages in", "out")}
    </Popover>
  );
}

/** The sender's round profile photo, loaded on demand and shared with the chat list. */
/** The draft a private reply starts with: the message being answered, quoted. */
function quoteForPrivateReply(m: NativeMessage) {
  const text = m.body || (m.media ? `[${m.media.kind}]` : "");
  return text
    ? `${text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}\n`
    : "";
}

function BubbleAvatar({
  accountId,
  chatId,
  connected,
  name,
  onClick,
}: {
  accountId: string;
  chatId: string | null;
  connected: boolean;
  name: string;
  onClick?: () => void;
}) {
  const picture = usePicture(accountId, chatId ?? "", connected && !!chatId);
  const avatar = <Avatar src={picture} name={name} size={28} />;
  return onClick ? (
    <button className="rounded-full" onClick={onClick} title="Profile">
      {avatar}
    </button>
  ) : (
    avatar
  );
}

const Bubble = memo(function Bubble({
  accountId,
  connected,
  message: m,
  album,
  showSender,
  avatar,
  avatarChatId,
  pinned,
  onMenu,
  onJumpTo,
  onProfile,
}: {
  accountId: string;
  connected: boolean;
  message: NativeMessage;
  /** The photos and videos sent together with this one, when it leads an album. */
  album?: NativeMessage[];
  showSender: boolean;
  /** Their round profile photo beside the bubble: shown, kept as blank space, or absent. */
  avatar: "show" | "space" | "none";
  avatarChatId: string | null;
  pinned: boolean;
  onMenu: (m: NativeMessage, pos: { x: number; y: number }) => void;
  onJumpTo: (bareId: string) => void;
  onProfile: (chatId: string) => void;
}) {
  const mine = m.fromMe;
  const sticker = m.media?.kind === "sticker";
  // Hooks run before the tombstone early return: a message can be deleted in place.
  const reactionMap = useReactions((s) => s.byMsg[bareId(m.id)]);
  const tomb = useRevoked((s) => s.items[`${convKey(accountId, m.chatId)}:${bareId(m.id)}`]);
  const [showEdits, setShowEdits] = useState(false);
  // Deleted for everyone: the stored copy keeps what it said; older tombstones only know that it went.
  const revoked = m.revokedAt != null || (!!tomb && (tomb.kind ?? "revoked") === "revoked");
  // A channel reports totals only; mine comes from what I reacted locally.
  const reactions =
    m.channelReactions.length > 0
      ? m.channelReactions.map((r) => ({ emoji: r.emoji, count: r.count, me: reactionMap?.me === r.emoji }))
      : summarize(reactionMap, []);
  return (
    <div className={cn("flex items-end gap-1.5", mine ? "justify-end" : "justify-start")}>
      {!mine && avatar !== "none" && (
        <div className="w-7 shrink-0">
          {avatar === "show" && (
            <BubbleAvatar
              accountId={accountId}
              chatId={avatarChatId}
              connected={connected}
              name={m.senderName || m.senderPhone || ""}
              onClick={avatarChatId ? () => onProfile(avatarChatId) : undefined}
            />
          )}
        </div>
      )}
      <div className={cn("flex flex-col max-w-[70%]", mine ? "items-end" : "items-start")}>
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu(m, { x: e.clientX, y: e.clientY });
          }}
          title="Right-click for more"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm selectable",
            revoked
              ? cn(
                  "border border-dashed",
                  mine
                    ? "border-wa-dark/40 bg-[#d9fdd3]/40 dark:bg-wa-teal/30"
                    : "border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-800/60",
                )
              : sticker
                ? "bg-transparent"
                : mine
                  ? "bg-[#d9fdd3] dark:bg-wa-teal text-neutral-900 dark:text-white shadow-sm"
                  : "bg-white dark:bg-neutral-800 shadow-sm",
          )}
        >
          {revoked && (
            <div className="flex items-center gap-1 text-xs italic text-neutral-500 dark:text-neutral-400 mb-0.5">
              🚫 {mine ? "You deleted this message" : "This message was deleted"}
              {m.revokedAt != null && <span className="not-italic text-[10px]">· {formatTime(secs(m.revokedAt))}</span>}
            </div>
          )}
          {showSender && (m.senderName || m.senderPhone) && (
            <div className="flex items-baseline gap-1.5 text-[11px] mb-0.5">
              <button
                className="font-semibold text-wa-dark dark:text-wa hover:underline disabled:no-underline"
                disabled={!avatarChatId}
                onClick={() => avatarChatId && onProfile(avatarChatId)}
              >
                {m.senderName || m.senderPhone}
              </button>
              {m.senderPhone && m.senderName && m.senderName !== m.senderPhone && <span className="text-neutral-400">{m.senderPhone}</span>}
            </div>
          )}
          {pinned && (
            <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-300/70 mb-0.5">
              <Pin size={10} /> Pinned
            </div>
          )}
          {m.replyTo && (
            <button
              onClick={() => (m.replyTo!.status ? useStoryJump.getState().open(m.replyTo!.id) : onJumpTo(bareId(m.replyTo!.id)))}
              className={cn(
                "mb-1 block w-full min-w-[140px] rounded-md border-l-4 border-wa-dark px-2 py-1 text-left text-xs",
                mine ? "bg-black/5 dark:bg-black/20" : "bg-neutral-100 dark:bg-neutral-700/60",
              )}
            >
              <div className="font-semibold text-wa-dark dark:text-wa truncate">
                {m.replyTo.fromMe ? "You" : m.replyTo.senderName || "Message"}
              </div>
              <div className="line-clamp-2 break-words text-neutral-600 dark:text-neutral-300">{m.replyTo.text || "Message"}</div>
            </button>
          )}
          <div className={cn(revoked && "opacity-60")}>
            {album ? (
              <div className="mb-1 grid grid-cols-2 gap-0.5 w-[300px]">
                {album.map((a) => (
                  <NativeMediaView key={a.id} accountId={accountId} message={a} connected={connected} tile />
                ))}
              </div>
            ) : m.media ? (
              <div className={cn(m.body && "mb-1")}>
                <NativeMediaView accountId={accountId} message={m} connected={connected} />
              </div>
            ) : m.kind !== "text" ? (
              <div className="italic text-neutral-500 dark:text-neutral-400">
                {m.kind === "media" ? "📎 Media (not available for this older message)" : "Unsupported message"}
              </div>
            ) : null}
            {album?.slice(1).map((a) =>
              a.body ? (
                <div key={a.id} className="break-words">
                  <WaMarkdown text={a.body} />
                </div>
              ) : null,
            )}
            {m.body && !m.media && !revoked && <LinkPreviewCard message={m} />}
            {m.body && (
              <div className={cn("break-words", revoked && "line-through decoration-neutral-400")}>
                <WaMarkdown text={m.body} />
              </div>
            )}
          </div>
          {showEdits && m.edits.length > 0 && (
            <div className="mt-1 space-y-1 border-l-2 border-neutral-300 dark:border-neutral-600 pl-2">
              {m.edits.map((e, i) => (
                <div key={i} className="text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="line-through break-words">{e.body}</span>
                  <span className="ml-1 text-[10px]">· replaced {formatTime(secs(e.replacedAt))}</span>
                </div>
              ))}
            </div>
          )}
          <TranslationView id={m.id} />
          <ImageNoteView id={m.id} />
          <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-300/70">
            {m.editedAt != null &&
              (m.edits.length > 0 ? (
                <button
                  onClick={() => setShowEdits((v) => !v)}
                  title={showEdits ? "Hide earlier versions" : `Show ${m.edits.length} earlier version${m.edits.length > 1 ? "s" : ""}`}
                  className="italic underline decoration-dotted hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  edited
                </button>
              ) : (
                <span className="italic">edited</span>
              ))}
            {formatTime(secs(m.timestamp))}
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
});

/** Forward a stored message to another chat of the same account. */
function NativeForwardDialog({
  accountId,
  fromChatId,
  message,
  onClose,
  onError,
}: {
  accountId: string;
  fromChatId: string;
  message: NativeMessage;
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const [chats, setChats] = useState<NativeChat[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    nativeWa
      .chats(accountId)
      .then(setChats)
      .catch((e) => onError(errMsg(e)));
  }, [accountId, onError]);

  const term = q.trim().toLowerCase();
  const list = (chats ?? [])
    .filter((c) => c.id !== "status@broadcast" && !isChannel(c.id))
    .filter((c) => !term || (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term))
    .slice(0, 50);

  const send = async (toChatId: string) => {
    setBusy(toChatId);
    try {
      await nativeWa.forward(accountId, fromChatId, message.id, toChatId);
      setDone((d) => new Set(d).add(toChatId));
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[380px] max-h-[70vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <span className="font-semibold flex-1">Forward to…</span>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-2 relative">
          <Search size={14} className="absolute left-4 top-4.5 text-neutral-400" />
          <Input className="pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.map((c) => {
            const name = c.name || displayId(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                <Avatar name={name} size={30} />
                <span className="flex-1 truncate text-sm">{name}</span>
                <Button
                  size="sm"
                  variant={done.has(c.id) ? "secondary" : "primary"}
                  disabled={busy === c.id || done.has(c.id)}
                  onClick={() => void send(c.id)}
                >
                  {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : done.has(c.id) ? "Sent" : "Send"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Pasted, dropped or picked file waiting to be sent, with the draft as its caption. */
interface Attachment {
  file: File;
  preview: string | null;
}

function Composer({
  account,
  chatId,
  chatName,
  messages,
  autoOut,
  picked,
  onPicked,
  onPick,
  onError,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
}: {
  account: NativeAccount;
  chatId: string;
  chatName: string;
  messages: NativeMessage[];
  /** Language your messages are translated into before sending, if set for this chat. */
  autoOut: string | undefined;
  /** A suggested reply chosen above the composer. */
  picked: string | null;
  onPicked: () => void;
  onPick: (text: string) => void;
  onError: (e: string) => void;
  /** The message being replied to, quoted when the text is sent. */
  replyTo: NativeMessage | null;
  /** The message being edited; sending replaces its text instead of a new message. */
  editing: NativeMessage | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
}) {
  // Unsent text is kept per chat, so switching away and back finds it again. Text loaded
  // for an edit is not a draft and is never saved.
  const draftKey = nativeChatKey(account.id, chatId);
  const [text, setTextRaw] = useState(() => useDrafts.getState().drafts[draftKey] ?? "");
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const setText = useCallback(
    (v: string) => {
      setTextRaw(v);
      if (!editingRef.current) useDrafts.getState().set(draftKey, v);
    },
    [draftKey],
  );
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const [slash, setSlash] = useState<string | null>(null); // "/query" at the start of the composer
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const connected = account.status === "working";

  // Typing presence: composing at most every 4s while typing, paused after 5s idle.
  const typingRef = useRef<{ last: number; timer?: ReturnType<typeof setTimeout> }>({ last: 0 });
  const stopTyping = () => {
    clearTimeout(typingRef.current.timer);
    if (typingRef.current.last) {
      typingRef.current.last = 0;
      void nativeWa.setTyping(account.id, chatId, false).catch(() => {});
    }
  };
  const noteTyping = () => {
    if (!sendTypingFor(nativeAccountKey(account.id))) return;
    const now = Date.now();
    if (now - typingRef.current.last > 4000) {
      typingRef.current.last = now;
      void nativeWa.setTyping(account.id, chatId, true).catch(() => {});
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 5000);
  };
  useEffect(() => stopTyping, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    taRef.current?.focus();
  }, [chatId]);

  // Choosing Reply puts the cursor in the composer.
  useEffect(() => {
    if (!replyTo) return;
    const frame = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [replyTo]);

  useEffect(() => {
    if (picked === null) return;
    setText(picked);
    onPicked();
    taRef.current?.focus();
  }, [picked, onPicked, setText]);

  // Editing loads the message's text into the composer; finishing or cancelling the edit
  // brings back whatever draft was there before.
  const draftBeforeEdit = useRef<string | null>(null);
  useEffect(() => {
    if (editing) {
      draftBeforeEdit.current ??= text;
      setText(editing.body);
      taRef.current?.focus();
    } else if (draftBeforeEdit.current !== null) {
      setText(draftBeforeEdit.current);
      draftBeforeEdit.current = null;
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the textarea's height in step with programmatic changes (send, emoji, AI rewrite).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  useEffect(() => () => void (attachment?.preview && URL.revokeObjectURL(attachment.preview)), [attachment]);

  const attach = (file: File) => setAttachment({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });

  const sendSticker = async (webp: Blob) => {
    if (sending || !connected) return;
    setSending(true);
    try {
      const sent = await nativeWa.sendMedia(account.id, chatId, webp, "sticker.webp", "", replyTo?.id ?? null, true);
      void cacheSentMedia(account.id, sent, webp);
      noteSticker(webp);
      onCancelReply();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  // Pasting a screenshot works wherever focus is, not only inside the text box.
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t !== taRef.current && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const img = clipboardImage(e.clipboardData);
      if (!img) return;
      e.preventDefault();
      attachRef.current(nameClipboardFile(img));
      taRef.current?.focus();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const submit = async () => {
    const draft = text.trim();
    if ((!draft && !attachment) || sending || !connected) return;
    stopTyping();
    // "Only when I reply": the receipt goes out right before our message.
    if (readReceiptsFor(nativeAccountKey(account.id)) === "on-reply") void nativeWa.sendReceipt(account.id, chatId).catch(() => {});
    setSending(true);
    try {
      const body = draft && autoOut && !editing ? await translate(draft, autoOut) : draft;
      if (editing) {
        await nativeWa.edit(account.id, chatId, editing.id, body);
        onCancelEdit();
      } else if (attachment) {
        const sent = await nativeWa.sendMedia(account.id, chatId, attachment.file, attachment.file.name, body, replyTo?.id ?? null);
        void cacheSentMedia(account.id, sent, attachment.file);
        setAttachment(null);
        onCancelReply();
      } else {
        await nativeWa.sendText(account.id, chatId, body, replyTo?.id ?? null);
        onCancelReply();
      }
      setText("");
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) attach(f);
      }}
      className={cn(
        "relative shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2",
        dragging && "ring-2 ring-inset ring-wa-dark",
      )}
    >
      {slash !== null && (
        <QuickReplyPicker
          query={slash}
          ctx={{ name: chatName, phone: chatId.endsWith("@s.whatsapp.net") ? `+${chatId.split("@")[0]}` : "" }}
          onClose={() => setSlash(null)}
          onPick={(t) => {
            setText(t);
            setSlash(null);
            requestAnimationFrame(() => taRef.current?.focus());
          }}
        />
      )}
      {!editing && <NativeSmartReplies accountId={account.id} chatId={chatId} chatName={chatName} messages={messages} onPick={onPick} />}
      {editing ? (
        <div className="flex items-start gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 text-xs">
          <Pencil size={14} className="mt-0.5 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-wa-dark dark:text-wa">Editing message</div>
            <div className="truncate text-neutral-500">{stripWaMarkdown(editing.body) || "📎 Media"}</div>
          </div>
          <button onClick={onCancelEdit} title="Cancel edit" className="p-1 text-neutral-500 hover:text-neutral-800">
            <X size={14} />
          </button>
        </div>
      ) : replyTo ? (
        <div className="flex items-start gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 text-xs">
          <Reply size={14} className="mt-0.5 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-wa-dark dark:text-wa">{replyTo.fromMe ? "You" : replyTo.senderName || "Them"}</div>
            <div className="truncate text-neutral-500">{stripWaMarkdown(replyTo.body) || "📎 Media"}</div>
          </div>
          <button onClick={onCancelReply} title="Cancel reply" className="p-1 text-neutral-500 hover:text-neutral-800">
            <X size={14} />
          </button>
        </div>
      ) : null}
      {!editing && attachment && (
        <div className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 text-xs">
          {attachment.preview ? (
            <img src={attachment.preview} alt="" className="w-10 h-10 rounded object-cover" />
          ) : (
            <Paperclip size={16} className="text-neutral-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{attachment.file.name}</div>
            <div className="text-neutral-500">{formatBytes(attachment.file.size)} · the text below is sent as its caption</div>
          </div>
          <button onClick={() => setAttachment(null)} title="Remove attachment" className="p-1 text-neutral-500 hover:text-neutral-800">
            <X size={14} />
          </button>
        </div>
      )}
      {autoOut && (
        <div className="text-[11px] text-neutral-500 flex items-center gap-1">
          <Languages size={12} /> Your messages are translated to {langName(autoOut)} before sending
        </div>
      )}
      <div className="flex items-end gap-1">
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) attach(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={!connected || !!editing}
          title="Attach a file"
        >
          <Paperclip size={18} />
        </Button>
        <TranslateDraftButton text={text} onResult={setText} />
        <WriteAssistButton text={text} onResult={setText} />
        <StickerButton onPick={sendSticker} disabled={!connected || !!editing || sending} />
        <EmojiButton
          onPick={(emoji) => {
            const ta = taRef.current;
            const start = ta?.selectionStart ?? text.length;
            const end = ta?.selectionEnd ?? text.length;
            setText(text.slice(0, start) + emoji + text.slice(end));
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
            noteTyping();
            const sl = v.match(/^\/(\S*)$/);
            setSlash(sl ? sl[1]! : null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          disabled={!connected}
          placeholder={
            !connected
              ? "Connect the account to send messages"
              : attachment
                ? "Add a caption (optional)"
                : "Type a message (Enter to send, Shift+Enter for newline)"
          }
          className="flex-1 resize-none rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-sm outline-none max-h-40 disabled:opacity-60"
        />
        <Button onClick={submit} disabled={(!text.trim() && !attachment) || sending || !connected} title="Send">
          {sending ? <Loader2 size={16} className="animate-spin" /> : autoOut ? <Languages size={16} /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
}

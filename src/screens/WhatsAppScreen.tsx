import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Languages,
  Loader2,
  LogOut,
  MoreVertical,
  Paperclip,
  Pencil,
  Play,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Users,
  Info,
  X,
} from "lucide-react";
import { Avatar, Button, Popover } from "@/components/ui";
import { confirm } from "@/components/Confirm";
import { EmojiButton } from "@/components/EmojiPicker";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResizeHandle, usePaneWidth } from "@/components/ResizeHandle";
import { LANGUAGES, aiConfigured, langName, translate } from "@/lib/ai";
import { formatBytes } from "@/lib/mediaCache";
import { cn, convKey, errMsg, formatDateDivider, formatTime, isGroup } from "@/lib/utils";
import { WaMarkdown, stripWaMarkdown } from "@/lib/waMarkdown";
import { nativeWa, type NativeAccount, type NativeChat, type NativeMessage, type NativeWaStatus } from "@/lib/nativeWa";
import { TranslateDraftButton, WriteAssistButton } from "@/screens/chats/Composer";
import { QuickReplyPicker } from "@/components/QuickReplyPicker";
import { ImageNoteView, TranslationView } from "@/screens/chats/MessageBubble";
import { NativeMessageMenu, NativeSmartReplies, NativeSummaryModal, useNativeAutoTranslate } from "@/screens/whatsapp/NativeAi";
import { NativeInfoPanel } from "@/screens/whatsapp/NativeInfoPanel";
import { usePicture } from "@/screens/whatsapp/usePicture";
import { NativeMediaView, cacheSentMedia, saveNativeMedia } from "@/screens/whatsapp/NativeMediaView";
import { readReceiptsFor, sendTypingFor } from "@/store/settings";
import { nativeAccountKey } from "@/lib/account";
import { Pairing } from "@/screens/whatsapp/Pairing";
import { useChatPrefs } from "@/store/chatPrefs";
import { useWhatsApp } from "@/store/whatsapp";

/**
 * Chat screen for a native WhatsApp account (the Rust client, no server and no embedded
 * WhatsApp Web), laid out and styled like the WAHA chat screen. Pairing happens in place:
 * while the account waits for a scan, the conversation area shows the QR code.
 *
 * History comes from the local store (see `whatsapp_db.rs`); attachments download on
 * demand; the AI tools are the WAHA screen's, adapted in `whatsapp/NativeAi`.
 */

const statusText: Record<NativeWaStatus, string> = {
  working: "Connected",
  starting: "Connecting…",
  qr: "Waiting for QR scan",
  failed: "Failed",
  logged_out: "Logged out",
  stopped: "Disconnected",
};

const statusDot: Record<NativeWaStatus, string> = {
  working: "bg-emerald-500",
  starting: "bg-amber-400 animate-pulse",
  qr: "bg-sky-500",
  failed: "bg-red-500",
  logged_out: "bg-red-500",
  stopped: "bg-neutral-400",
};

/** Timestamps from the backend are milliseconds; the shared formatters take seconds. */
const secs = (ms: number) => Math.floor(ms / 1000);

/**
 * How WhatsApp itself labels a chat: a saved contact by its name; anyone else by their
 * number, with the name they gave themselves as "~name".
 */
function chatLabel(chat: NativeChat | undefined, chatId: string) {
  if (!chat) return { title: chatId.split("@")[0]!, pushName: null };
  if (chat.saved || !chat.phone) return { title: chat.name, pushName: null };
  return { title: chat.phone, pushName: chat.name !== chat.phone ? chat.name : null };
}

type Filter = "all" | "unread" | "groups";

/** Messages read from the local history per page. */
const PAGE = 100;

export function WhatsAppScreen({ account, header }: { account: NativeAccount; header: React.ReactNode }) {
  const tick = useWhatsApp((s) => s.messageTick);
  const setOpenChat = useWhatsApp((s) => s.setOpenChat);
  const [listWidth, setListWidth] = usePaneWidth("chatList", 320, 240, 560);
  const [chats, setChats] = useState<NativeChat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
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
        error={error}
        onError={setError}
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
          onOpenChat={(ids) => setChatId(ids.find((id) => chats.some((c) => c.id === id)) ?? ids[ids.length - 1]!)}
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
  error,
  onError,
  width,
}: {
  account: NativeAccount;
  header: React.ReactNode;
  chats: NativeChat[];
  selected: string | null;
  onSelect: (id: string) => void;
  error: string | null;
  onError: (e: string | null) => void;
  width: number;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("wahana:focus-search", focus);
    return () => window.removeEventListener("wahana:focus-search", focus);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "groups" && !isGroup(c.id)) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.id.includes(needle) ||
        (c.phone ?? "").replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\0") ||
        c.lastText.toLowerCase().includes(needle)
      );
    });
  }, [chats, q, filter]);

  return (
    <div
      style={{ width }}
      className="shrink-0 flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
    >
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        {header}
        <AccountBar account={account} onError={onError} />
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
          {(["all", "unread", "groups"] as const).map((f) => (
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
        </div>
      </div>
      {(error || account.error) && (
        <div className="px-3 py-2 text-xs bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 selectable">
          {error ?? account.error}
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
          shown.map((c) => (
            <ChatRow
              key={c.id}
              chat={c}
              accountId={account.id}
              connected={account.status === "working"}
              active={c.id === selected}
              onClick={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Status line under the picker, with the account's actions in a menu. */
function AccountBar({ account, onError }: { account: NativeAccount; onError: (e: string | null) => void }) {
  const rename = useWhatsApp((s) => s.rename);
  const remove = useWhatsApp((s) => s.remove);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(account.name);
  useEffect(() => setName(account.name), [account.name]);

  const run = (action: () => Promise<unknown>) => () => {
    setOpen(false);
    onError(null);
    action().catch((e) => onError(errMsg(e)));
  };
  const commit = () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === account.name) return setName(account.name);
    rename(account.id, next).catch((e) => {
      setName(account.name);
      onError(errMsg(e));
    });
  };
  const live = account.status === "starting" || account.status === "qr" || account.status === "working";

  return (
    <div className="flex items-center gap-2 px-1 text-xs text-neutral-500">
      <span className={cn("w-2 h-2 rounded-full shrink-0", statusDot[account.status])} />
      {renaming ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setName(account.name);
              setRenaming(false);
            }
          }}
          className="flex-1 min-w-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-800 dark:text-neutral-100 outline-none"
        />
      ) : (
        <span className="flex-1 min-w-0 truncate">
          {account.syncing != null ? `Syncing history… ${account.syncing}%` : statusText[account.status]}
          {account.me?.pushName && ` · ${account.me.pushName}`}
        </span>
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-52 py-1"
        trigger={
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} title="Account">
            <MoreVertical size={14} />
          </Button>
        }
      >
        <MenuButton
          icon={Pencil}
          label="Rename…"
          onClick={() => {
            setOpen(false);
            setRenaming(true);
          }}
        />
        {live ? (
          <MenuButton icon={Square} label="Disconnect" onClick={run(() => nativeWa.stop(account.id))} />
        ) : (
          <MenuButton icon={Play} label="Connect" onClick={run(() => nativeWa.start(account.id))} />
        )}
        <MenuButton
          icon={LogOut}
          label="Log out"
          disabled={account.status !== "working"}
          onClick={run(() => nativeWa.logout(account.id))}
        />
        <MenuButton
          icon={Trash2}
          label="Remove account…"
          danger
          onClick={run(async () => {
            const ok = await confirm({
              title: `Remove “${account.name}”?`,
              message: "Its session data is deleted from this computer. Log out first to also remove it from your phone's linked devices.",
              danger: true,
              confirmLabel: "Remove",
            });
            if (ok) await remove(account.id);
          })}
        />
      </Popover>
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent",
        danger && "text-red-600",
      )}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

const ChatRow = memo(function ChatRow({
  chat,
  accountId,
  connected,
  active,
  onClick,
}: {
  chat: NativeChat;
  accountId: string;
  connected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const picture = usePicture(accountId, chat.id, connected);
  const group = isGroup(chat.id);
  const { title, pushName } = chatLabel(chat, chat.id);
  const body = stripWaMarkdown(chat.lastText);
  const sender = group ? (chat.lastFromMe ? "You" : chat.lastSender.split(/\s+/)[0]) : "";
  const preview = sender ? `${sender}: ${body}` : body;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        active && "bg-neutral-100 dark:bg-neutral-800",
      )}
    >
      <Avatar src={picture} name={pushName ?? title} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {group && <Users size={12} className="text-neutral-400 shrink-0" />}
          <span className="font-medium truncate shrink-0 max-w-[70%]">{title}</span>
          {pushName && <span className="text-[11px] text-neutral-400 truncate">~{pushName}</span>}
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
            {chat.lastFromMe && <Check size={12} className="inline mr-1 -mt-0.5" />}
            {preview}
          </div>
          {chat.unread > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-wa text-[10px] font-bold text-white grid place-items-center">
              {chat.unread}
            </span>
          )}
        </div>
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
  onError,
}: {
  account: NativeAccount;
  chatId: string;
  chat: NativeChat | undefined;
  tick: number;
  /** Open a direct chat: candidate chat ids, best first. */
  onOpenChat: (ids: string[]) => void;
  onError: (e: string) => void;
}) {
  const [info, setInfo] = useState(false);
  const { title, pushName } = chatLabel(chat, chatId);
  const name = pushName ?? title;
  const prefsKey = convKey(account.id, chatId);
  const autoTranslate = useChatPrefs((s) => s.autoTranslate[prefsKey]);
  const [menu, setMenu] = useState<{ m: NativeMessage; pos: { x: number; y: number } } | null>(null);
  const [summary, setSummary] = useState(false);
  const [draftPick, setDraftPick] = useState<string | null>(null);
  const [messages, setMessages] = useState<NativeMessage[]>([]);
  const [limit, setLimit] = useState(PAGE);
  /** Waiting for the phone to answer a request for older messages. */
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  /** Scroll position to restore after older messages are prepended. */
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const group = isGroup(chatId);
  const connected = account.status === "working";
  const picture = usePicture(account.id, chatId, connected);
  const moreStored = messages.length >= limit;

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
  }, [messages]);

  useNativeAutoTranslate(messages, autoTranslate?.in);
  const onMenu = useCallback((m: NativeMessage, pos: { x: number; y: number }) => setMenu({ m, pos }), []);

  const loadOlder = () => {
    const el = listRef.current;
    anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    setLimit((l) => l + PAGE);
    if (moreStored) return;
    setAsking(true);
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
            onClick={() => setInfo((v) => !v)}
            title={group ? "Group info" : "Contact info"}
          >
            <Avatar src={picture} name={name} size={36} />
            <div className="min-w-0">
              <div className="font-medium truncate">{title}</div>
              <div className="text-xs truncate text-neutral-500">
                {group ? "Group · click for members" : pushName ? `~${pushName}` : chat?.saved && chat.phone ? chat.phone : "Contact"}
              </div>
            </div>
          </button>
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
                <Loader2 size={12} className="animate-spin" /> Asking your phone for older messages…
              </span>
            ) : connected && messages.length > 0 ? (
              <button
                onClick={loadOlder}
                className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-wa-dark dark:text-wa shadow-sm hover:bg-white dark:hover:bg-neutral-700"
              >
                Load older messages from your phone
              </button>
            ) : messages.length === 0 ? (
              <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                No messages stored for this chat yet
              </span>
            ) : null}
          </div>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
            const showSender = group && !m.fromMe && (newDay || prev?.fromMe || prev?.senderName !== m.senderName);
            return (
              <div key={m.id} className="pb-1">
                {newDay && (
                  <div className="flex justify-center my-3">
                    <span className="rounded-md bg-white/80 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-sm">
                      {formatDateDivider(secs(m.timestamp))}
                    </span>
                  </div>
                )}
                <ErrorBoundary inline label="message">
                  <Bubble accountId={account.id} connected={connected} message={m} showSender={showSender} onMenu={onMenu} />
                </ErrorBoundary>
              </div>
            );
          })}
        </div>

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
        />
        {menu && (
          <NativeMessageMenu
            accountId={account.id}
            message={menu.m}
            pos={menu.pos}
            onSave={() => saveNativeMedia(account.id, menu.m).catch((e) => onError(errMsg(e)))}
            onClose={() => setMenu(null)}
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
      {info && (
        <NativeInfoPanel
          accountId={account.id}
          chatId={chatId}
          connected={connected}
          picture={picture}
          onOpenChat={onOpenChat}
          onClose={() => setInfo(false)}
        />
      )}
    </>
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

const Bubble = memo(function Bubble({
  accountId,
  connected,
  message: m,
  showSender,
  onMenu,
}: {
  accountId: string;
  connected: boolean;
  message: NativeMessage;
  showSender: boolean;
  onMenu: (m: NativeMessage, pos: { x: number; y: number }) => void;
}) {
  const mine = m.fromMe;
  const sticker = m.media?.kind === "sticker";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col max-w-[70%]", mine ? "items-end" : "items-start")}>
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu(m, { x: e.clientX, y: e.clientY });
          }}
          title="Right-click for more"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm selectable",
            sticker
              ? "bg-transparent"
              : mine
                ? "bg-[#d9fdd3] dark:bg-wa-teal text-neutral-900 dark:text-white shadow-sm"
                : "bg-white dark:bg-neutral-800 shadow-sm",
          )}
        >
          {showSender && (m.senderName || m.senderPhone) && (
            <div className="flex items-baseline gap-1.5 text-[11px] mb-0.5">
              <span className="font-semibold text-wa-dark dark:text-wa">{m.senderName || m.senderPhone}</span>
              {m.senderPhone && m.senderName && m.senderName !== m.senderPhone && <span className="text-neutral-400">{m.senderPhone}</span>}
            </div>
          )}
          {m.media ? (
            <div className={cn(m.body && "mb-1")}>
              <NativeMediaView accountId={accountId} message={m} connected={connected} />
            </div>
          ) : m.kind !== "text" ? (
            <div className="italic text-neutral-500 dark:text-neutral-400">
              {m.kind === "media" ? "📎 Media (not available for this older message)" : "Unsupported message"}
            </div>
          ) : null}
          {m.body && (
            <div className="break-words">
              <WaMarkdown text={m.body} />
            </div>
          )}
          <TranslationView id={m.id} />
          <ImageNoteView id={m.id} />
          <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-300/70">
            {formatTime(secs(m.timestamp))}
            {mine && <Check size={12} />}
          </div>
        </div>
      </div>
    </div>
  );
});

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
}) {
  const [text, setText] = useState("");
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

  useEffect(() => {
    if (picked === null) return;
    setText(picked);
    onPicked();
    taRef.current?.focus();
  }, [picked, onPicked]);

  // Keep the textarea's height in step with programmatic changes (send, emoji, AI rewrite).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  useEffect(() => () => void (attachment?.preview && URL.revokeObjectURL(attachment.preview)), [attachment]);

  const attach = (file: File) => setAttachment({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });

  const submit = async () => {
    const draft = text.trim();
    if ((!draft && !attachment) || sending || !connected) return;
    stopTyping();
    // "Only when I reply": the receipt goes out right before our message.
    if (readReceiptsFor(nativeAccountKey(account.id)) === "on-reply") void nativeWa.sendReceipt(account.id, chatId).catch(() => {});
    setSending(true);
    try {
      const body = draft && autoOut ? await translate(draft, autoOut) : draft;
      if (attachment) {
        const sent = await nativeWa.sendMedia(account.id, chatId, attachment.file, attachment.file.name, body);
        void cacheSentMedia(account.id, sent, attachment.file);
        setAttachment(null);
      } else {
        await nativeWa.sendText(account.id, chatId, body);
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
      <NativeSmartReplies accountId={account.id} chatId={chatId} chatName={chatName} messages={messages} onPick={onPick} />
      {attachment && (
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
      <div className="flex items-end gap-2">
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
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={!connected} title="Attach a file">
          <Paperclip size={18} />
        </Button>
        <TranslateDraftButton text={text} onResult={setText} />
        <WriteAssistButton text={text} onResult={setText} />
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
          onPaste={(e) => {
            const f = [...e.clipboardData.files][0];
            if (f) {
              e.preventDefault();
              attach(f);
            }
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

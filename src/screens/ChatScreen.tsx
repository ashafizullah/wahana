import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { useChats, useMessages, useSessions } from "@/api/queries";
import type { WAMessage } from "@/api/types";
import { ContactModal } from "@/components/ContactModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InfoPanel } from "@/components/InfoPanel";
import { MessageInfoModal } from "@/components/MessageInfo";
import { MessageMenu, type MenuPos } from "@/components/MessageMenu";
import { NotConnected } from "@/components/NotConnected";
import { ResizeHandle, usePaneWidth } from "@/components/ResizeHandle";
import { SummaryModal } from "@/components/SummaryModal";
import { Button } from "@/components/ui";
import { cn, convKey, displayId, formatDateDivider, isGroup } from "@/lib/utils";
import { useNameResolver } from "@/realtime/useNames";
import { presenceLabel, usePresence } from "@/realtime/usePresence";
import { useChatPrefs } from "@/store/chatPrefs";
import { requireClient, useSettings } from "@/store/settings";
import { chatKey, useUnread } from "@/store/unread";
import { useWaWeb } from "@/store/waWeb";
import { WhatsAppWebScreen } from "@/screens/WhatsAppWebScreen";
import { ChatList, SessionPicker } from "@/screens/chats/ChatList";
import { Composer } from "@/screens/chats/Composer";
import { ConversationHeader } from "@/screens/chats/ConversationHeader";
import { Bubble } from "@/screens/chats/MessageBubble";
import { MessageSearchBar } from "@/screens/chats/MessageSearchBar";
import { useMessageList } from "@/screens/chats/useMessageList";
import { useAutoTranslateIncoming, useOrderedMessages } from "@/screens/chats/useOrderedMessages";

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
        <Button variant="secondary" onClick={() => addWaWeb()}>
          Use WhatsApp Web instead
        </Button>
      </NotConnected>
    );
  }
  if (sessions && !sessionInfo) {
    return <Empty>Session “{session}” not found on server. Pick one in Sessions.</Empty>;
  }
  if (sessionInfo && sessionInfo.status !== "WORKING") {
    return (
      <Empty>
        Session “{session}” is {sessionInfo.status}. Start / log in from Sessions.
      </Empty>
    );
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
  const ordered = useOrderedMessages(session, chatId, messages);
  const group = isGroup(chatId);

  const [replyTo, setReplyTo] = useState<WAMessage | null>(null);
  const [editing, setEditing] = useState<WAMessage | null>(null);
  const [menu, setMenu] = useState<{ m: WAMessage; pos: MenuPos } | null>(null);
  const [info, setInfo] = useState(false);
  const [msgInfo, setMsgInfo] = useState<WAMessage | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const presence = usePresence(session, chatId);
  const resolveName = useNameResolver(session, chatId);
  const presenceText = presenceLabel(presence, chatId, group, (id) => resolveName(id) ?? displayId(id));
  const { data: sessionsForMe } = useSessions();
  const me = sessionsForMe?.find((x) => x.name === session)?.me;
  const meId = me?.id,
    meLid = me?.lid,
    meJid = me?.jid;
  const myIds = useMemo(() => [meId, meLid, meJid].filter((x): x is string => !!x), [meId, meLid, meJid]);

  const {
    listRef,
    topRef,
    contentRef,
    virtualizer,
    hasMore,
    hasNewer,
    loadingOlder,
    loadingNewer,
    highlight,
    loadOlder,
    jumpTo,
    jumpToDate,
    backToLatest,
  } = useMessageList(session, chatId, ordered);

  useAutoTranslateIncoming(
    ordered,
    useChatPrefs((s) => s.autoTranslate[convKey(session, chatId)]?.in),
  );

  // Unread bookkeeping. The last-opened time is captured before markSeen() overwrites it, for "since I last read" summaries.
  const seenAtRef = useRef<number | undefined>(undefined);
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
    if (useSettings.getState().readReceipts === "always")
      requireClient()
        .sendSeen(session, chatId)
        .catch(() => {});
  }, [session, chatId, newestIncomingId, markSeen]);

  // ⌘/Ctrl+F opens in-chat search (the bar refocuses itself when already open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Stable identity so memoised bubbles don't re-render on every parent tick (state setters already are).
  const onMenuStable = useCallback((m: WAMessage, pos: MenuPos) => setMenu({ m, pos }), []);

  return (
    <>
      <div className="flex-1 min-w-0 flex flex-col bg-[#efeae2] dark:bg-neutral-950">
        <ConversationHeader
          session={session}
          chatId={chatId}
          chat={chat}
          name={name}
          presenceText={presenceText}
          ordered={ordered}
          resolveName={resolveName}
          onToggleInfo={() => setInfo((v) => !v)}
          onToggleSearch={() => setSearchOpen((v) => !v)}
          onSummary={() => setSummary(true)}
          onJumpToDate={jumpToDate}
        />
        {searchOpen && (
          <MessageSearchBar
            ordered={ordered}
            resolveName={resolveName}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void loadOlder()}
            onJump={jumpTo}
            onClose={() => setSearchOpen(false)}
          />
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
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div
                    id={`msg-${m.id}`}
                    className={cn("rounded-lg transition-colors", highlight === m.id && "bg-amber-200/60 dark:bg-amber-500/20")}
                  >
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
                        onReply={setReplyTo}
                        onMenu={onMenuStable}
                        resolveName={resolveName}
                        myIds={myIds}
                        onJump={jumpTo}
                        onSender={setContactId}
                      />
                    </ErrorBoundary>
                  </div>
                </div>
              );
            })}
          </div>
          {hasNewer && (
            <div className="h-6 grid place-items-center text-neutral-400">
              {loadingNewer && <Loader2 size={16} className="animate-spin" />}
            </div>
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

import { useEffect, useState } from "react";
import { MessageSquare, Radio, Settings as SettingsIcon, Loader2, Download, X, Activity, CircleDashed, CalendarClock, Megaphone, Bot } from "lucide-react";
import { useSettings } from "@/store/settings";
import { useWahaSocket } from "@/realtime/useWahaSocket";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SessionsScreen } from "@/screens/SessionsScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { EventsScreen } from "@/screens/EventsScreen";
import { StatusScreen } from "@/screens/StatusScreen";
import { SchedulerScreen } from "@/screens/SchedulerScreen";
import { BroadcastScreen } from "@/screens/BroadcastScreen";
import { AutoReplyScreen } from "@/screens/AutoReplyScreen";
import { useBroadcastRunner } from "@/realtime/useBroadcastRunner";
import { useScheduler } from "@/realtime/useScheduler";
import { useWaWeb } from "@/store/waWeb";
import { useAutoReply } from "@/realtime/useAutoReply";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmHost } from "@/components/Confirm";
import { useHidden } from "@/store/hidden";
import { useRevoked } from "@/store/revoked";
import { useDrafts } from "@/store/drafts";
import { useChatPrefs } from "@/store/chatPrefs";
import { usePolls } from "@/store/polls";
import { useCalls } from "@/store/calls";
import { CallBanner } from "@/components/CallBanner";
import { useLiveMessages } from "@/store/liveMessages";
import { cn } from "@/lib/utils";
import { totalUnread, useUnread } from "@/store/unread";
import { useBadge } from "@/realtime/useBadge";
import { usePushNames } from "@/store/pushNames";
import { useReactions } from "@/store/reactions";
import { useReceipts } from "@/store/receipts";
import { useUpdater } from "@/realtime/useUpdater";
import { Button } from "@/components/ui";

type Tab = "chats" | "status" | "scheduler" | "broadcast" | "autoreply" | "sessions" | "events" | "settings";

export default function App() {
  const { hydrated, hydrate, client } = useSettings();
  const [tab, setTab] = useState<Tab>("chats");
  const socket = useWahaSocket();
  const unreadCounts = useUnread((s) => s.counts);
  const hydrateUnread = useUnread((s) => s.hydrate);
  const hydratePushNames = usePushNames((s) => s.hydrate);
  const hydrateReactions = useReactions((s) => s.hydrate);
  const hydrateReceipts = useReceipts((s) => s.hydrate);
  const hydrateHidden = useHidden((s) => s.hydrate);
  const hydrateRevoked = useRevoked((s) => s.hydrate);
  const hydrateDrafts = useDrafts((s) => s.hydrate);
  const hydrateChatPrefs = useChatPrefs((s) => s.hydrate);
  const hydratePolls = usePolls((s) => s.hydrate);
  const hydrateCalls = useCalls((s) => s.hydrate);
  const hydrateLive = useLiveMessages((s) => s.hydrate);
  const hydrateWaWeb = useWaWeb((s) => s.hydrate);
  const unread = totalUnread(unreadCounts);
  useBadge(unread);
  const updater = useUpdater();
  useScheduler();
  useBroadcastRunner();
  useAutoReply();

  useEffect(() => {
    void hydrate();
    void hydrateUnread();
    void hydratePushNames();
    void hydrateReactions();
    void hydrateReceipts();
    void hydrateHidden();
    void hydrateRevoked();
    void hydrateDrafts();
    void hydrateChatPrefs();
    void hydrateWaWeb();
    void hydratePolls();
    void hydrateCalls();
    void hydrateLive();
  }, [hydrate, hydrateUnread, hydratePushNames, hydrateReactions, hydrateReceipts, hydrateHidden, hydrateRevoked, hydrateDrafts, hydrateChatPrefs, hydratePolls, hydrateCalls, hydrateLive, hydrateWaWeb]);

  useEffect(() => {
    if (hydrated && !client) setTab("settings");
  }, [hydrated, client]);

  // Global shortcuts: ⌘/Ctrl+1/2/3 switch tabs, ⌘/Ctrl+K focus chat search, ⌘/Ctrl+, opens settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tabs: Record<string, Tab> = { "1": "chats", "2": "status", "3": "scheduler", "4": "broadcast", "5": "autoreply", "6": "sessions", "7": "events", "8": "settings" };
      if (tabs[e.key]) {
        e.preventDefault();
        setTab(tabs[e.key]!);
      } else if (e.key === "k") {
        e.preventDefault();
        setTab("chats");
        setTimeout(() => window.dispatchEvent(new CustomEvent("wahana:focus-search")), 0);
      } else if (e.key === ",") {
        e.preventDefault();
        setTab("settings");
      }
    };
    const onOpenSettings = () => setTab("settings");
    window.addEventListener("keydown", onKey);
    window.addEventListener("wahana:open-settings", onOpenSettings);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wahana:open-settings", onOpenSettings);
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="h-full grid place-items-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const nav: { id: Tab; icon: typeof MessageSquare; label: string }[] = [
    { id: "chats", icon: MessageSquare, label: "Chats (⌘1)" },
    { id: "status", icon: CircleDashed, label: "Status (⌘2)" },
    { id: "scheduler", icon: CalendarClock, label: "Scheduler (⌘3)" },
    { id: "broadcast", icon: Megaphone, label: "Broadcast (⌘4)" },
    { id: "autoreply", icon: Bot, label: "Auto-reply (⌘5)" },
    { id: "sessions", icon: Radio, label: "Sessions (⌘6)" },
    { id: "events", icon: Activity, label: "Events (⌘7)" },
    { id: "settings", icon: SettingsIcon, label: "Settings (⌘8)" },
  ];

  return (
    <div className="h-full flex">
      <ConfirmHost />
      <aside className="w-16 shrink-0 flex flex-col items-center py-4 gap-2 bg-wa-teal text-white/80">
        {nav.map((n) => (
          <button
            key={n.id}
            title={n.label}
            onClick={() => setTab(n.id)}
            className={cn(
              "relative w-11 h-11 rounded-xl grid place-items-center hover:bg-white/10 transition",
              tab === n.id && "bg-white/20 text-white",
            )}
          >
            <n.icon size={22} />
            {n.id === "chats" && unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-wa text-[10px] font-bold text-wa-teal grid place-items-center">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        ))}
        <div className="mt-auto flex flex-col items-center gap-1 text-[10px]">
          <span
            title={`Realtime: ${socket}`}
            className={cn(
              "w-2.5 h-2.5 rounded-full",
              socket === "open" && "bg-wa",
              socket === "connecting" && "bg-amber-400 animate-pulse",
              (socket === "closed" || socket === "idle") && "bg-red-400",
            )}
          />
          <span className="opacity-70">WS</span>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        <CallBanner />
        {updater.update && (
          <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-wa-dark text-white text-sm">
            <Download size={16} />
            <span className="flex-1">
              Wahana {updater.update.version} is available.
              {updater.progress !== null && ` Downloading… ${Math.round(updater.progress * 100)}%`}
              {updater.error && <span className="ml-2 text-red-200 selectable">{updater.error}</span>}
            </span>
            <Button size="sm" variant="secondary" onClick={updater.install} disabled={updater.progress !== null}>
              Install & restart
            </Button>
            <button onClick={updater.dismiss} title="Later"><X size={16} /></button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex">
          <ErrorBoundary key={tab} label={tab}>
            {tab === "chats" && <ChatScreen />}
            {tab === "status" && <StatusScreen />}
            {tab === "scheduler" && <SchedulerScreen />}
          {tab === "broadcast" && <BroadcastScreen />}
            {tab === "autoreply" && <AutoReplyScreen />}
            {tab === "sessions" && <SessionsScreen />}
            {tab === "events" && <EventsScreen />}
            {tab === "settings" && <SettingsScreen onSaved={() => setTab("sessions")} />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

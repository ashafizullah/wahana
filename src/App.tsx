import { useEffect, useState } from "react";
import { MessageSquare, Radio, Settings as SettingsIcon, Loader2, Download, X, Activity, CircleDashed, Sparkles } from "lucide-react";
import { useSettings } from "@/store/settings";
import { useWahaSocket } from "@/realtime/useWahaSocket";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WelcomeScreen } from "@/screens/WelcomeScreen";
import { SessionsScreen } from "@/screens/SessionsScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { EventsScreen } from "@/screens/EventsScreen";
import { StatusScreen } from "@/screens/StatusScreen";
import { FeaturesScreen } from "@/screens/FeaturesScreen";
import { useBroadcastRunner } from "@/realtime/useBroadcastRunner";
import { pruneLogs } from "@/store/scheduler";
import { useAutoLabel } from "@/realtime/useAutoLabel";
import { useScheduler } from "@/realtime/useScheduler";
import { totalWhatsAppUnread, useWhatsApp } from "@/store/whatsapp";
import { useAutoReply } from "@/realtime/useAutoReply";
import { useProfileSockets } from "@/realtime/useProfileSockets";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmHost } from "@/components/Confirm";
import { useHidden } from "@/store/hidden";
import { useRevoked } from "@/store/revoked";
import { usePins } from "@/store/pins";
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

type Tab = "chats" | "status" | "features" | "sessions" | "events" | "settings";

export default function App() {
  const { hydrated, hydrate, client, profiles } = useSettings();
  const waHydrated = useWhatsApp((s) => s.hydrated);
  const waAccounts = useWhatsApp((s) => s.accounts);
  // First run: nothing configured at all. `null` until both stores have loaded so the
  // screen neither flashes for existing users nor is skipped for new ones.
  const [welcome, setWelcome] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("chats");
  const socket = useWahaSocket();
  const unreadCounts = useUnread((s) => s.counts);
  const hydrateUnread = useUnread((s) => s.hydrate);
  const hydratePushNames = usePushNames((s) => s.hydrate);
  const hydrateReactions = useReactions((s) => s.hydrate);
  const hydrateReceipts = useReceipts((s) => s.hydrate);
  const hydrateHidden = useHidden((s) => s.hydrate);
  const hydrateRevoked = useRevoked((s) => s.hydrate);
  const hydratePins = usePins((s) => s.hydrate);
  const hydrateDrafts = useDrafts((s) => s.hydrate);
  const hydrateChatPrefs = useChatPrefs((s) => s.hydrate);
  const hydratePolls = usePolls((s) => s.hydrate);
  const hydrateCalls = useCalls((s) => s.hydrate);
  const hydrateLive = useLiveMessages((s) => s.hydrate);
  const hydrateWa = useWhatsApp((s) => s.hydrate);
  const unread = totalUnread(unreadCounts) + totalWhatsAppUnread(waAccounts);
  useBadge(unread);
  const updater = useUpdater();
  useScheduler();
  useBroadcastRunner();
  useAutoReply();
  useProfileSockets();
  useAutoLabel();
  useEffect(() => {
    pruneLogs().catch((e) => console.warn("log pruning failed", e));
  }, []);

  useEffect(() => {
    void hydrate();
    void hydrateUnread();
    void hydratePushNames();
    void hydrateReactions();
    void hydrateReceipts();
    void hydrateHidden();
    void hydrateRevoked();
    void hydratePins();
    void hydrateDrafts();
    void hydrateChatPrefs();
    hydrateWa().catch(console.error);
    void hydratePolls();
    void hydrateCalls();
    void hydrateLive();
  }, [
    hydrate,
    hydrateUnread,
    hydratePushNames,
    hydrateReactions,
    hydrateReceipts,
    hydrateHidden,
    hydrateRevoked,
    hydratePins,
    hydrateDrafts,
    hydrateChatPrefs,
    hydratePolls,
    hydrateCalls,
    hydrateLive,
    hydrateWa,
  ]);

  useEffect(() => {
    if (hydrated && waHydrated && welcome === null) setWelcome(profiles.length === 0 && waAccounts.length === 0);
  }, [hydrated, waHydrated, welcome, profiles.length, waAccounts.length]);
  useEffect(() => {
    // A linked WhatsApp account is enough to chat; only send people with neither to Settings.
    if (hydrated && waHydrated && !client && waAccounts.length === 0) setTab("settings");
  }, [hydrated, waHydrated, client, waAccounts.length]);

  // Global shortcuts: ⌘/Ctrl+1/2/3 switch tabs, ⌘/Ctrl+K focus chat search, ⌘/Ctrl+, opens settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tabs: Record<string, Tab> = {
        "1": "chats",
        "2": "status",
        "3": "features",
        "4": "sessions",
        "5": "events",
        "6": "settings",
      };
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
    const onOpenWelcome = () => setWelcome(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wahana:open-settings", onOpenSettings);
    window.addEventListener("wahana:open-welcome", onOpenWelcome);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wahana:open-settings", onOpenSettings);
      window.removeEventListener("wahana:open-welcome", onOpenWelcome);
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="h-full grid place-items-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const allNav: { id: Tab; icon: typeof MessageSquare; label: string }[] = [
    { id: "chats", icon: MessageSquare, label: "Chats (⌘1)" },
    { id: "status", icon: CircleDashed, label: "Status (⌘2)" },
    { id: "features", icon: Sparkles, label: "Features: Scheduler, Broadcast, Auto-reply, Tweaks (⌘3)" },
    { id: "sessions", icon: Radio, label: "Sessions (⌘4)" },
    { id: "events", icon: Activity, label: "Events (⌘5)" },
    { id: "settings", icon: SettingsIcon, label: "Settings (⌘6)" },
  ];
  // Events is the WAHA websocket stream; native accounts have no equivalent.
  const nav = allNav.filter((n) => n.id !== "events" || !!client);

  return (
    <div className="h-full flex">
      <ConfirmHost />
      <aside className="w-16 shrink-0 flex flex-col items-center py-4 gap-2 bg-wa-teal text-white/80">
        {nav.map((n) => (
          <button
            key={n.id}
            title={n.label}
            onClick={() => {
              setWelcome(false);
              setTab(n.id);
            }}
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
            <button onClick={updater.dismiss} title="Later">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex">
          <ErrorBoundary key={welcome ? "welcome" : tab} label={welcome ? "welcome" : tab}>
            {welcome && (
              <WelcomeScreen
                onDone={(t) => {
                  setWelcome(false);
                  setTab(t);
                }}
              />
            )}
            {!welcome && tab === "chats" && <ChatScreen />}
            {!welcome && tab === "status" && <StatusScreen />}
            {!welcome && tab === "features" && <FeaturesScreen />}
            {!welcome && tab === "sessions" && <SessionsScreen />}
            {!welcome && tab === "events" && <EventsScreen />}
            {!welcome && tab === "settings" && <SettingsScreen onSaved={() => setTab("sessions")} />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

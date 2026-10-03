import { useEffect, useState } from "react";
import { MessageSquare, Smartphone, Settings as SettingsIcon, Loader2, Download, X, CircleDashed, Sparkles } from "lucide-react";
import { useSettings } from "@/store/settings";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WelcomeScreen } from "@/screens/WelcomeScreen";
import { AccountsScreen } from "@/screens/AccountsScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { StatusScreen } from "@/screens/StatusScreen";
import { FeaturesScreen } from "@/screens/FeaturesScreen";
import { useBroadcastRunner } from "@/realtime/useBroadcastRunner";
import { pruneLogs } from "@/store/scheduler";
import { useAutoLabel } from "@/realtime/useAutoLabel";
import { useScheduler } from "@/realtime/useScheduler";
import { totalWhatsAppUnread, useWhatsApp } from "@/store/whatsapp";
import { useAutoReply } from "@/realtime/useAutoReply";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmHost } from "@/components/Confirm";
import { useRevoked } from "@/store/revoked";
import { usePins } from "@/store/pins";
import { useDrafts } from "@/store/drafts";
import { useChatPrefs } from "@/store/chatPrefs";
import { cn } from "@/lib/utils";
import { useBadge } from "@/realtime/useBadge";
import { useReactions } from "@/store/reactions";
import { useUpdater } from "@/realtime/useUpdater";
import { Button } from "@/components/ui";

type Tab = "chats" | "status" | "features" | "accounts" | "settings";

export default function App() {
  const { hydrated, hydrate } = useSettings();
  const waHydrated = useWhatsApp((s) => s.hydrated);
  const waAccounts = useWhatsApp((s) => s.accounts);
  // First run: nothing configured at all. `null` until both stores have loaded so the
  // screen neither flashes for existing users nor is skipped for new ones.
  const [welcome, setWelcome] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("chats");
  const hydrateReactions = useReactions((s) => s.hydrate);
  const hydrateRevoked = useRevoked((s) => s.hydrate);
  const hydratePins = usePins((s) => s.hydrate);
  const hydrateDrafts = useDrafts((s) => s.hydrate);
  const hydrateChatPrefs = useChatPrefs((s) => s.hydrate);
  const hydrateWa = useWhatsApp((s) => s.hydrate);
  const unread = totalWhatsAppUnread(waAccounts);
  useBadge(unread);
  const updater = useUpdater();
  useScheduler();
  useBroadcastRunner();
  useAutoReply();
  useAutoLabel();
  useEffect(() => {
    pruneLogs().catch((e) => console.warn("log pruning failed", e));
  }, []);

  useEffect(() => {
    void hydrate();
    void hydrateReactions();
    void hydrateRevoked();
    void hydratePins();
    void hydrateDrafts();
    void hydrateChatPrefs();
    hydrateWa().catch(console.error);
  }, [hydrate, hydrateReactions, hydrateRevoked, hydratePins, hydrateDrafts, hydrateChatPrefs, hydrateWa]);

  useEffect(() => {
    if (hydrated && waHydrated && welcome === null) setWelcome(waAccounts.length === 0);
  }, [hydrated, waHydrated, welcome, waAccounts.length]);

  // Global shortcuts: ⌘/Ctrl+1/2/3 switch tabs, ⌘/Ctrl+K focus chat search, ⌘/Ctrl+, opens settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tabs: Record<string, Tab> = {
        "1": "chats",
        "2": "status",
        "3": "features",
        "4": "accounts",
        "5": "settings",
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
    const onOpenAccounts = () => setTab("accounts");
    const onOpenStatus = () => setTab("status");
    const onOpenWelcome = () => setWelcome(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wahana:open-accounts", onOpenAccounts);
    window.addEventListener("wahana:open-status", onOpenStatus);
    window.addEventListener("wahana:open-welcome", onOpenWelcome);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wahana:open-accounts", onOpenAccounts);
      window.removeEventListener("wahana:open-status", onOpenStatus);
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

  const nav: { id: Tab; icon: typeof MessageSquare; label: string }[] = [
    { id: "chats", icon: MessageSquare, label: "Chats (⌘1)" },
    { id: "status", icon: CircleDashed, label: "Status (⌘2)" },
    { id: "features", icon: Sparkles, label: "Features: Scheduler, Broadcast, Auto-reply, Tweaks (⌘3)" },
    { id: "accounts", icon: Smartphone, label: "Accounts (⌘4)" },
    { id: "settings", icon: SettingsIcon, label: "Settings (⌘5)" },
  ];

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
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
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
            {!welcome && tab === "accounts" && <AccountsScreen />}
            {!welcome && tab === "settings" && <SettingsScreen />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

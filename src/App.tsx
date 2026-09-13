import { useEffect, useState } from "react";
import { MessageSquare, Radio, Settings as SettingsIcon, Loader2, Download, X, Activity } from "lucide-react";
import { useSettings } from "@/store/settings";
import { useWahaSocket } from "@/realtime/useWahaSocket";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SessionsScreen } from "@/screens/SessionsScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { EventsScreen } from "@/screens/EventsScreen";
import { cn } from "@/lib/utils";
import { totalUnread, useUnread } from "@/store/unread";
import { useBadge } from "@/realtime/useBadge";
import { useUpdater } from "@/realtime/useUpdater";
import { Button } from "@/components/ui";

type Tab = "chats" | "sessions" | "events" | "settings";

export default function App() {
  const { hydrated, hydrate, client } = useSettings();
  const [tab, setTab] = useState<Tab>("chats");
  const socket = useWahaSocket();
  const unreadCounts = useUnread((s) => s.counts);
  const hydrateUnread = useUnread((s) => s.hydrate);
  const unread = totalUnread(unreadCounts);
  useBadge(unread);
  const updater = useUpdater();

  useEffect(() => {
    void hydrate();
    void hydrateUnread();
  }, [hydrate, hydrateUnread]);

  useEffect(() => {
    if (hydrated && !client) setTab("settings");
  }, [hydrated, client]);

  // Global shortcuts: ⌘/Ctrl+1/2/3 switch tabs, ⌘/Ctrl+K focus chat search, ⌘/Ctrl+, opens settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tabs: Record<string, Tab> = { "1": "chats", "2": "sessions", "3": "events", "4": "settings" };
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    { id: "sessions", icon: Radio, label: "Sessions (⌘2)" },
    { id: "events", icon: Activity, label: "Events (⌘3)" },
    { id: "settings", icon: SettingsIcon, label: "Settings (⌘4)" },
  ];

  return (
    <div className="h-full flex">
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
          {tab === "chats" && <ChatScreen onNeedSetup={() => setTab("settings")} />}
          {tab === "sessions" && <SessionsScreen />}
          {tab === "events" && <EventsScreen />}
          {tab === "settings" && <SettingsScreen onSaved={() => setTab("sessions")} />}
        </div>
      </main>
    </div>
  );
}

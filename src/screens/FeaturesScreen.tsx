import { useState } from "react";
import { Bot, CalendarClock, Megaphone, SlidersHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountScopePicker, ScopeCtx } from "./settings/shared";
import { TweaksSection } from "./settings/TweaksSection";
import { QuickRepliesSection } from "./settings/QuickRepliesSection";
import { SchedulerScreen } from "./SchedulerScreen";
import { BroadcastScreen } from "./BroadcastScreen";
import { AutoReplyScreen } from "./AutoReplyScreen";

const TAB_KEY = "features.tab";
const SCOPE_KEY = "settings.scope";

const FEATURES = [
  { id: "scheduler", icon: CalendarClock, label: "Scheduler" },
  { id: "broadcast", icon: Megaphone, label: "Broadcast" },
  { id: "autoreply", icon: Bot, label: "Auto-reply" },
  { id: "tweaks", icon: SlidersHorizontal, label: "Tweaks" },
  { id: "quickreplies", icon: Zap, label: "Quick replies" },
] as const;
type FeatureId = (typeof FEATURES)[number]["id"];

function loadTab(): FeatureId {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return FEATURES.some((f) => f.id === v) ? (v as FeatureId) : "scheduler";
  } catch {
    return "scheduler";
  }
}
function loadScope(): string {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function FeaturesScreen() {
  const [tab, setTabState] = useState<FeatureId>(loadTab);
  const [scope, setScopeState] = useState<string>(loadScope);
  const setTab = (t: FeatureId) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const setScope = (v: string) => {
    setScopeState(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <nav className="shrink-0 flex items-center gap-1 px-4 pt-3 border-b border-neutral-200 dark:border-neutral-800">
        {FEATURES.map((f) => (
          <button
            key={f.id}
            onClick={() => setTab(f.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition",
              tab === f.id
                ? "border-wa-dark text-wa-dark font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
            )}
          >
            <f.icon size={16} />
            {f.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0 flex">
        {tab === "scheduler" && <SchedulerScreen />}
        {tab === "broadcast" && <BroadcastScreen />}
        {tab === "autoreply" && <AutoReplyScreen />}
        {tab === "quickreplies" && (
          <ScopeCtx.Provider value={{ scope, setScope }}>
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-4">
                <h1 className="text-xl font-semibold">Quick replies</h1>
                <p className="text-xs text-neutral-500">
                  Type / in the composer to insert one. Variables: {"{name} {phone} {time} {date}"}.
                </p>
                <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2">
                  <AccountScopePicker />
                </div>
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4 space-y-4">
                  <QuickRepliesSection />
                </div>
              </div>
            </div>
          </ScopeCtx.Provider>
        )}
        {tab === "tweaks" && (
          <ScopeCtx.Provider value={{ scope, setScope }}>
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-4">
                <h1 className="text-xl font-semibold">Tweaks</h1>
                <p className="text-xs text-neutral-500">
                  Behaviour switches. They apply to what Wahana does — your phone follows its own WhatsApp settings.
                </p>
                <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2">
                  <AccountScopePicker />
                </div>
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4 space-y-4">
                  <TweaksSection />
                </div>
              </div>
            </div>
          </ScopeCtx.Provider>
        )}
      </div>
    </div>
  );
}

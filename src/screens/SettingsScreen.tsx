import { useEffect, useState } from "react";
import { Bell, DatabaseBackup, HardDrive, Image as ImageIcon, Info, Plug, Server, SlidersHorizontal, Sparkles, Zap } from "lucide-react";
import { usingFallback } from "@/lib/secrets";
import { OpenCtx, Section } from "./settings/shared";
import { ProfilesSection } from "./settings/ProfilesSection";
import { ConnectionSection } from "./settings/ConnectionSection";
import { MediaSection } from "./settings/MediaSection";
import { StorageSection } from "./settings/StorageSection";
import { TweaksSection } from "./settings/TweaksSection";
import { AiSection } from "./settings/AiSection";
import { QuickRepliesSection } from "./settings/QuickRepliesSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { BackupSection } from "./settings/BackupSection";
import { AboutSection } from "./settings/AboutSection";

const OPEN_KEY = "settings.open";
const DEFAULT_OPEN = ["Servers", "Connection"];
function loadOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
}
const ALL_SECTIONS = [
  "Servers",
  "Connection",
  "Media",
  "Storage",
  "Tweaks",
  "AI",
  "Quick replies",
  "Notifications",
  "Backup & restore",
  "About",
];

export function SettingsScreen({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState<string[]>(loadOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* ignore */
    }
  }, [open]);
  const toggle = (t: string) => setOpen((o) => (o.includes(t) ? o.filter((x) => x !== t) : [...o, t]));
  const allOpen = ALL_SECTIONS.every((t) => open.includes(t));
  return (
    <OpenCtx.Provider value={{ open, toggle }}>
      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold flex-1">Settings</h1>
            <button className="text-xs text-neutral-500 hover:text-wa-dark" onClick={() => setOpen(allOpen ? [] : ALL_SECTIONS)}>
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          {usingFallback() && (
            <div className="rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-3 py-2 text-xs">
              The OS keychain is unavailable on this machine, so API keys are kept in a local file (unencrypted). They still never leave
              your computer.
            </div>
          )}
          <Section
            icon={Server}
            title="Servers"
            description="You can keep several WAHA servers and switch between them. Each server's API key is stored in the OS keychain (macOS Keychain / Windows Credential Manager)."
          >
            <ProfilesSection />
          </Section>
          <Section icon={Plug} title="Connection" description="Settings for the selected server.">
            <ConnectionSection onSaved={onSaved} />
          </Section>
          <Section
            icon={ImageIcon}
            title="Media"
            description="Choose what downloads automatically. Disabled kinds show a blurred preview until you click them — saves bandwidth and server work."
          >
            <MediaSection />
          </Section>
          <Section
            icon={HardDrive}
            title="Storage"
            description="Downloaded media is kept on disk so it is not fetched again. Oldest files are evicted when the cap is reached."
          >
            <StorageSection />
          </Section>
          <Section
            icon={SlidersHorizontal}
            title="Tweaks"
            description="Behaviour switches. They apply to what Wahana does — your phone follows its own WhatsApp settings."
          >
            <TweaksSection />
          </Section>
          <Section
            icon={Sparkles}
            title="AI"
            description="Bring your own model. Anthropic uses the official SDK; OpenAI-compatible works with routers (TokenRouter, OpenRouter, Groq), Ollama, etc. The key is stored in the OS keychain."
          >
            <AiSection />
          </Section>
          <Section
            icon={Zap}
            title="Quick replies"
            description="Type / in the composer to insert one. Variables: {name} {phone} {time} {date}."
          >
            <QuickRepliesSection />
          </Section>
          <Section icon={Bell} title="Notifications">
            <NotificationsSection />
          </Section>
          <Section
            icon={DatabaseBackup}
            title="Backup & restore"
            description="Export your configuration to a JSON file and import it on another machine or after a reinstall."
          >
            <BackupSection />
          </Section>
          <Section icon={Info} title="About">
            <AboutSection />
          </Section>
        </div>
      </div>
    </OpenCtx.Provider>
  );
}

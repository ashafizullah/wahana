import { useState } from "react";
import { ArrowRight, CheckCircle2, Globe, Loader2, Server, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { WahaClient } from "@/api/client";
import { useSettings } from "@/store/settings";
import { useWaWeb } from "@/store/waWeb";
import { Button, Input, Label } from "@/components/ui";
import { cn, errMsg } from "@/lib/utils";

/** Ask App to show the welcome screen again (Settings → About). */
export const openWelcome = () => window.dispatchEvent(new CustomEvent("wahana:open-welcome"));

/**
 * First-run screen: shown while the app has neither a WAHA server nor a WhatsApp Web
 * session. Two ways in — open WhatsApp Web right away, or connect a WAHA server — and a
 * way out to Settings for people who know what they want.
 */
export function WelcomeScreen({ onDone }: { onDone: (tab: "chats" | "sessions" | "settings") => void }) {
  const addWaWeb = useWaWeb((s) => s.add);
  const [mode, setMode] = useState<"pick" | "waha">("pick");
  return (
    <div className="flex-1 overflow-auto grid place-items-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <img src="/logo.png" alt="" className="w-16 h-16 mx-auto rounded-2xl shadow" />
          <h1 className="text-2xl font-semibold">Welcome to Wahana</h1>
          <p className="text-sm text-neutral-500">One desktop app for WhatsApp Web and WAHA. How do you want to start?</p>
        </div>

        {mode === "pick" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card
              icon={Globe}
              title="Use WhatsApp Web"
              body="No server needed. Scan the QR code with your phone, like in a browser. Add more accounts later and show them side by side."
              action="Open WhatsApp Web"
              onClick={() => {
                addWaWeb("WhatsApp Web");
                onDone("chats");
              }}
            />
            <Card
              icon={Server}
              title="Connect a WAHA server"
              body="Unlocks scheduling, broadcasts, auto-reply, AI tools and more. You need the server URL and its API key."
              action="Connect…"
              onClick={() => setMode("waha")}
            />
          </div>
        ) : (
          <WahaForm onBack={() => setMode("pick")} onConnected={() => onDone("sessions")} />
        )}

        <p className="text-center text-xs text-neutral-500">
          Know your way around?{" "}
          <button className="underline hover:text-wa-dark" onClick={() => onDone("settings")}>
            Skip to Settings
          </button>
          . You can bring this screen back from Settings → About.
        </p>
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  body,
  action,
  onClick,
}: {
  icon: typeof Globe;
  title: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group text-left rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3",
        "hover:border-wa-dark hover:shadow-md transition",
      )}
    >
      <Icon size={24} className="text-wa-dark" />
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-neutral-500 min-h-[3.5rem]">{body}</p>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-wa-dark">
        {action} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

/** Same fields as Settings → Connection, but creates the first server profile. */
function WahaForm({ onBack, onConnected }: { onBack: () => void; onConnected: () => void }) {
  const addProfile = useSettings((s) => s.addProfile);
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const ready = baseUrl.trim() !== "" && apiKey.trim() !== "";

  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      const v = await new WahaClient({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }).serverVersion();
      setResult({ ok: true, text: `Connected: WAHA ${v.version} · ${v.engine} · ${v.tier}` });
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };
  const connect = async () => {
    setBusy("save");
    try {
      await addProfile({ name: "Default", baseUrl, apiKey });
      qc.clear();
      onConnected();
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void connect();
      }}
    >
      <div className="flex items-center gap-2">
        <Server size={18} className="text-wa-dark" />
        <h2 className="font-semibold flex-1">Connect a WAHA server</h2>
        <button type="button" className="text-xs text-neutral-500 hover:text-wa-dark" onClick={onBack}>
          Back
        </button>
      </div>
      <div>
        <Label>WAHA base URL</Label>
        <Input
          autoFocus
          placeholder="https://waha.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div>
        <Label>API key</Label>
        <Input
          type="password"
          placeholder="plain API key (not the sha512: hash)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-xs text-neutral-500 mt-1">Stored in the OS keychain; it never leaves this computer.</p>
      </div>
      {result && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            result.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300",
          )}
        >
          {result.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
          <span className="selectable">{result.text}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={test} disabled={!ready || busy !== null}>
          {busy === "test" && <Loader2 size={14} className="animate-spin" />} Test connection
        </Button>
        <Button type="submit" disabled={!ready || busy !== null}>
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} Connect
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { confirm } from "@/components/Confirm";
import { CheckCircle2, XCircle, Loader2, Plug, Image as ImageIcon, Bell, Info, Plus, Trash2, Server, HardDrive, RefreshCw, SlidersHorizontal } from "lucide-react";
import { cacheClear, cacheStats, formatBytes, type CacheStats } from "@/lib/mediaCache";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { WahaClient } from "@/api/client";
import { Button, Input, Label } from "@/components/ui";
import { useServerVersion } from "@/api/queries";
import { getVersion } from "@tauri-apps/api/app";

export function SettingsScreen({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Section icon={Server} title="Servers" description="You can keep several WAHA servers and switch between them. Each server's API key is stored in the OS keychain.">
          <ProfilesSection />
        </Section>
        <Section icon={Plug} title="Connection" description="Settings for the selected server.">
          <ConnectionSection onSaved={onSaved} />
        </Section>
        <Section icon={ImageIcon} title="Media" description="Choose what downloads automatically. Disabled kinds show a blurred preview until you click them — saves bandwidth and server work.">
          <MediaSection />
        </Section>
        <Section icon={HardDrive} title="Storage" description="Downloaded media is kept on disk so it is not fetched again. Oldest files are evicted when the cap is reached.">
          <StorageSection />
        </Section>
        <Section icon={SlidersHorizontal} title="Tweaks" description="Behaviour switches. They apply to what Wahana does — your phone follows its own WhatsApp settings.">
          <TweaksSection />
        </Section>
        <Section icon={Bell} title="Notifications">
          <NotificationsSection />
        </Section>
        <Section icon={Info} title="About">
          <AboutSection />
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Plug;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <header className="px-5 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon size={16} className="text-wa-dark" /> {title}
        </h2>
        {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
      </header>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <span className="flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative h-6 w-11 rounded-full transition " + (checked ? "bg-wa-dark" : "bg-neutral-300 dark:bg-neutral-700")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition " + (checked ? "left-[22px]" : "left-0.5")
          }
        />
      </button>
    </label>
  );
}

// ── Servers (profiles) ───────────────────────────────────────────────────

function ProfilesSection() {
  const { profiles, activeProfile, switchProfile, removeProfile, addProfile } = useSettings();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await new WahaClient({ baseUrl: url.trim(), apiKey: key.trim() }).serverVersion();
      await addProfile({ name, baseUrl: url, apiKey: key });
      qc.clear();
      setAdding(false);
      setName("");
      setUrl("");
      setKey("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {profiles.length === 0 && !adding && <p className="text-sm text-neutral-500">No server yet — fill in Connection below or add one.</p>}
      <ul className="space-y-1">
        {profiles.map((p) => (
          <li
            key={p.id}
            className={
              "flex items-center gap-3 rounded-lg px-3 py-2 " +
              (p.id === activeProfile ? "bg-wa-dark/10 ring-1 ring-wa-dark/40" : "bg-neutral-50 dark:bg-neutral-800/60")
            }
          >
            <span className={"w-2 h-2 rounded-full " + (p.id === activeProfile ? "bg-wa" : "bg-neutral-400")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{p.name}</span>
              <span className="block text-xs text-neutral-500 truncate selectable">{p.baseUrl} · {p.session}</span>
            </span>
            {p.id !== activeProfile && (
              <Button size="sm" variant="secondary" onClick={async () => { await switchProfile(p.id); qc.clear(); }}>
                Use
              </Button>
            )}
            <button
              className="text-neutral-400 hover:text-red-600"
              title="Remove server"
              onClick={async () => {
                if (await confirm({ title: `Remove server "${p.name}"?`, danger: true, confirmLabel: "Confirm" })) {
                  await removeProfile(p.id);
                  qc.clear();
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="space-y-3 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" autoFocus /></div>
          <div><Label>Base URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://waha.example.com" spellCheck={false} /></div>
          <div><Label>API key</Label><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} /></div>
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex gap-2">
            <Button onClick={add} disabled={busy || !url || !key}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Test & add"}</Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}><Plus size={14} /> Add server</Button>
      )}
    </>
  );
}

// ── Connection ───────────────────────────────────────────────────────────

function ConnectionSection({ onSaved }: { onSaved: () => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const activeName = settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "";
  const [name, setName] = useState(activeName);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
    setName(activeName);
    setResult(null);
  }, [settings.activeProfile, settings.baseUrl, settings.apiKey, activeName]);

  const dirty = baseUrl.trim() !== settings.baseUrl || apiKey.trim() !== settings.apiKey || name.trim() !== activeName;

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const v = await new WahaClient({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }).serverVersion();
      setResult({ ok: true, text: `WAHA ${v.version} · ${v.engine} · ${v.tier}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await settings.save({ baseUrl, apiKey, name: name || undefined });
      qc.clear();
      onSaved();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div>
        <Label>Server name</Label>
        <Input placeholder="Default" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>WAHA base URL</Label>
        <Input placeholder="https://waha.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <Label>API key</Label>
        <Input type="password" placeholder="plain API key (not the sha512: hash)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>
      {result && (
        <div
          className={
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm " +
            (result.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300")
          }
        >
          {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="selectable">{result.text}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={test} disabled={testing || !baseUrl || !apiKey}>
          {testing && <Loader2 size={14} className="animate-spin" />} Test connection
        </Button>
        <Button onClick={save} disabled={saving || !baseUrl || !apiKey || !dirty}>
          {saving && <Loader2 size={14} className="animate-spin" />} Save
        </Button>
        {settings.profiles.length > 0 && (
          <Button
            variant="ghost"
            className="ml-auto text-red-600"
            onClick={async () => {
              if (!(await confirm({ title: "Remove all servers and keys from this device?", danger: true, confirmLabel: "Confirm" }))) return;
              await settings.clear();
              setBaseUrl("");
              setApiKey("");
              setResult(null);
              qc.clear();
            }}
          >
            Forget all
          </Button>
        )}
      </div>
    </>
  );
}

// ── Media ────────────────────────────────────────────────────────────────

function MediaSection() {
  const s = useSettings();
  const qc = useQueryClient();
  const set = async (patch: Parameters<typeof s.save>[0]) => {
    await s.save(patch);
    // Message lists are fetched with the auto-download list; refetch so placeholders update.
    qc.invalidateQueries({ queryKey: ["messages"] });
  };
  return (
    <>
      <Toggle label="Auto-load images" hint="Photos appear immediately." checked={s.autoLoadImages} onChange={(v) => set({ autoLoadImages: v })} />
      <Toggle label="Auto-load stickers" hint="Detected from the message type (stickers are webp images)." checked={s.autoLoadStickers} onChange={(v) => set({ autoLoadStickers: v })} />
      <Toggle label="Auto-load videos" hint="Videos can be large; off shows a blurred frame with the size." checked={s.autoLoadVideos} onChange={(v) => set({ autoLoadVideos: v })} />
      <Toggle label="Auto-load voice notes & audio" checked={s.autoLoadAudio} onChange={(v) => set({ autoLoadAudio: v })} />
      <p className="text-xs text-neutral-500">Documents are never downloaded automatically — click to open.</p>

    </>
  );
}

// ── Storage ──────────────────────────────────────────────────────────────

function StorageSection() {
  const limit = useSettings((s) => s.cacheLimitMb);
  const save = useSettings((s) => s.save);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitText, setLimitText] = useState(String(limit));

  const refresh = async () => {
    try {
      setStats(await cacheStats());
    } catch (e) {
      console.warn(e);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => setLimitText(String(limit)), [limit]);

  return (
    <>
      <div className="flex items-center gap-3 text-sm">
        <span className="flex-1 min-w-0">
          <span className="block font-medium">{stats ? `${formatBytes(stats.bytes)} · ${stats.files} file${stats.files === 1 ? "" : "s"}` : "—"}</span>
          {stats && (
            <span className="block text-xs text-neutral-500 selectable truncate" title={stats.path}>
              {stats.path}
            </span>
          )}
        </span>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={refresh} title="Refresh"><RefreshCw size={14} /></Button>
        <Button
          size="sm"
          variant="danger"
          className="shrink-0"
          disabled={busy || !stats?.files}
          onClick={async () => {
            if (!(await confirm({ title: "Delete all cached media? They will be downloaded again when viewed.", danger: true, confirmLabel: "Confirm" }))) return;
            setBusy(true);
            try {
              await cacheClear();
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Clear cache
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1">
          <span className="block text-sm">Cache limit</span>
          <span className="block text-xs text-neutral-500">Megabytes; 0 means unlimited.</span>
        </span>
        <Input
          className="w-28 text-right"
          type="number"
          min={0}
          value={limitText}
          onChange={(e) => setLimitText(e.target.value)}
          onBlur={() => {
            const n = Math.max(0, Math.round(Number(limitText) || 0));
            if (n !== limit) void save({ cacheLimitMb: n });
          }}
        />
        <span className="text-sm text-neutral-500">MB</span>
      </div>
    </>
  );
}

// ── Tweaks ───────────────────────────────────────────────────────────────

function TweaksSection() {
  const s = useSettings();
  const qc = useQueryClient();
  const receiptOptions: { value: typeof s.readReceipts; label: string; hint: string }[] = [
    { value: "always", label: "When I open the chat", hint: "Blue ticks as soon as the conversation is on screen (WhatsApp default)." },
    { value: "on-reply", label: "Only when I reply", hint: "Read the chat silently; ticks turn blue the moment you send a message, file or reaction-free reply." },
    { value: "manual", label: "Manually, with a button", hint: "Nothing is sent when you open a chat. A ✓✓ button in the chat header sends the receipt when you decide." },
    { value: "never", label: "Never", hint: "Senders keep grey ticks. Status views are not reported either." },
  ];
  return (
    <>
      <Toggle
        label="Show typing indicator"
        hint='Sends "typing…" while you write. Off = they only see the message when it arrives.'
        checked={s.sendTyping}
        onChange={(v) => s.save({ sendTyping: v })}
      />
      <div>
        <div className="text-sm mb-1">Read receipts (blue ticks)</div>
        <div className="space-y-1.5">
          {receiptOptions.map((o) => (
            <label key={o.value} className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="readReceipts" className="mt-1" checked={s.readReceipts === o.value} onChange={() => s.save({ readReceipts: o.value })} />
              <span>
                <span className="block text-sm">{o.label}</span>
                <span className="block text-xs text-neutral-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <Toggle
        label="Fetch link previews"
        hint="When a link has no preview from the sender, fetch the page's title/description/image yourself (a request to that site). Off = only sender-provided previews."
        checked={s.linkPreviews}
        onChange={async (v) => {
          await s.save({ linkPreviews: v });
          qc.invalidateQueries({ queryKey: ["messages"] });
        }}
      />
    </>
  );
}

// ── Notifications ────────────────────────────────────────────────────────

function NotificationsSection() {
  const s = useSettings();
  return (
    <Toggle
      label="Desktop notifications"
      hint="Show a system notification for incoming messages from any session."
      checked={s.notifications}
      onChange={(v) => s.save({ notifications: v })}
    />
  );
}

// ── About ────────────────────────────────────────────────────────────────

function AboutSection() {
  const { data: server } = useServerVersion();
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-neutral-500">App</dt>
      <dd className="selectable">Wahana {appVersion}</dd>
      <dt className="text-neutral-500">Server</dt>
      <dd className="selectable">{server ? `WAHA ${server.version} · ${server.engine} · ${server.tier} · ${server.platform}` : "—"}</dd>
    </dl>
  );
}

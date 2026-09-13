import { useEffect, useState, type ReactNode } from "react";
import { confirm } from "@/components/Confirm";
import { CheckCircle2, XCircle, Loader2, Plug, Image as ImageIcon, Bell, Info, Plus, Trash2, Server, HardDrive, RefreshCw, SlidersHorizontal, Zap, Pencil, Sparkles } from "lucide-react";
import { DEFAULT_MODELS, LANGUAGES, testAi } from "@/lib/ai";
import { usingFallback } from "@/lib/secrets";
import { exportBackup, pickBackup, restoreBackup, type Backup, type RestoreOptions } from "@/lib/backup";
import { DatabaseBackup, Upload, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { deleteQuickReply, listQuickReplies, saveQuickReply, type QuickReply } from "@/store/quickReplies";
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
        {usingFallback() && (
          <div className="rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-3 py-2 text-xs">
            The OS keychain is unavailable on this machine, so API keys are kept in a local file (unencrypted). They still never leave your computer.
          </div>
        )}
        <Section icon={Server} title="Servers" description="You can keep several WAHA servers and switch between them. Each server's API key is stored in the OS keychain (macOS Keychain / Windows Credential Manager).">
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
        <Section icon={Sparkles} title="AI" description="Bring your own model. Anthropic uses the official SDK; OpenAI-compatible works with routers (TokenRouter, OpenRouter, Groq), Ollama, etc. The key is stored in the OS keychain.">
          <AiSection />
        </Section>
        <Section icon={Zap} title="Quick replies" description="Type / in the composer to insert one. Variables: {name} {phone} {time} {date}.">
          <QuickRepliesSection />
        </Section>
        <Section icon={Bell} title="Notifications">
          <NotificationsSection />
        </Section>
        <Section icon={DatabaseBackup} title="Backup & restore" description="Export your configuration to a JSON file and import it on another machine or after a reinstall.">
          <BackupSection />
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
    { value: "manual", label: "Manually, with a button", hint: "Nothing is sent when you open a chat or a status. A ✓✓ button (chat header / status viewer) sends the receipt when you decide." },
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

// ── AI ───────────────────────────────────────────────────────────────────

function AiSection() {
  const s = useSettings();
  const [provider, setProvider] = useState(s.aiProvider);
  const [baseUrl, setBaseUrl] = useState(s.aiBaseUrl);
  const [model, setModel] = useState(s.aiModel);
  const [key, setKey] = useState(s.aiApiKey);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setProvider(s.aiProvider); setBaseUrl(s.aiBaseUrl); setModel(s.aiModel); setKey(s.aiApiKey); }, [s.aiProvider, s.aiBaseUrl, s.aiModel, s.aiApiKey]);
  const dirty = provider !== s.aiProvider || baseUrl.trim() !== s.aiBaseUrl || model.trim() !== s.aiModel || key.trim() !== s.aiApiKey;
  const cfg = { provider, baseUrl: baseUrl.trim(), model: model.trim() || DEFAULT_MODELS[provider], apiKey: key.trim() };

  return (
    <>
      <div>
        <Label>Provider</Label>
        <div className="flex gap-1">
          {([["anthropic", "Anthropic (Claude)"], ["openai-compatible", "OpenAI-compatible"]] as const).map(([id, label]) => (
            <Button key={id} size="sm" variant={provider === id ? "primary" : "secondary"} onClick={() => { setProvider(id); if (!model || model === DEFAULT_MODELS[provider]) setModel(DEFAULT_MODELS[id]); }}>{label}</Button>
          ))}
        </div>
      </div>
      <div>
        <Label>{provider === "anthropic" ? "Base URL (optional — leave empty for api.anthropic.com)" : "Base URL (e.g. https://api.tokenrouter.com/v1)"}</Label>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === "anthropic" ? "https://api.anthropic.com" : "https://…/v1"} spellCheck={false} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Model</Label><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "anthropic" ? "claude-opus-5" : "e.g. gpt-4.1-mini, llama3"} spellCheck={false} /></div>
        <div><Label>API key</Label><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Translate incoming messages to</Label>
          <select value={s.aiTranslateTo} onChange={(e) => s.save({ aiTranslateTo: e.target.value })} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none">
            {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div>
          <Label>Translate my drafts to (🌐 in composer)</Label>
          <select value={s.aiComposeTo} onChange={(e) => s.save({ aiComposeTo: e.target.value })} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none">
            {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
      </div>
      {result && (
        <div className={"flex items-center gap-2 rounded-lg px-3 py-2 text-sm " + (result.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300")}>
          {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<span className="selectable break-all">{result.text}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy !== null || !cfg.apiKey || !cfg.model || (provider !== "anthropic" && !cfg.baseUrl)} onClick={async () => { setBusy("test"); setResult(null); try { const out = await testAi(cfg); setResult({ ok: true, text: `Model replied: ${out.slice(0, 80)}` }); } catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); } }}>
          {busy === "test" && <Loader2 size={14} className="animate-spin" />} Test
        </Button>
        <Button disabled={busy !== null || !dirty} onClick={async () => { setBusy("save"); try { await s.save({ aiProvider: provider, aiBaseUrl: cfg.baseUrl, aiModel: cfg.model, aiApiKey: cfg.apiKey }); setResult({ ok: true, text: "Saved." }); } finally { setBusy(null); } }}>
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} Save
        </Button>
      </div>
    </>
  );
}

// ── Quick replies ────────────────────────────────────────────────────────

function QuickRepliesSection() {
  const profile = useSettings((s) => s.activeProfile);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["quick-replies", profile], queryFn: () => listQuickReplies(profile), enabled: !!profile });
  const [editing, setEditing] = useState<Partial<QuickReply> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["quick-replies", profile] });

  return (
    <>
      <ul className="space-y-1">
        {q.data?.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">/{r.shortcut}</span>
              <span className="block text-xs text-neutral-500 whitespace-pre-wrap selectable">{r.text}</span>
            </span>
            <button className="text-neutral-400 hover:text-neutral-700" onClick={() => setEditing(r)} title="Edit"><Pencil size={14} /></button>
            <button className="text-neutral-400 hover:text-red-600" title="Delete" onClick={async () => { if (await confirm({ title: `Delete /${r.shortcut}?`, danger: true, confirmLabel: "Delete" })) { await deleteQuickReply(r.id); refresh(); } }}><Trash2 size={14} /></button>
          </li>
        ))}
        {q.data?.length === 0 && !editing && <li className="text-sm text-neutral-500">No quick replies yet.</li>}
      </ul>
      {editing ? (
        <div className="space-y-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3">
          <div><Label>Shortcut</Label><Input value={editing.shortcut ?? ""} onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })} placeholder="thanks" autoFocus /></div>
          <div>
            <Label>Text</Label>
            <textarea value={editing.text ?? ""} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={3} placeholder="Terima kasih {name}, pesanan kamu sedang diproses." className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none" />
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                const shortcut = (editing.shortcut ?? "").replace(/^\//, "").trim();
                if (!shortcut || /\s/.test(shortcut)) return setErr("Shortcut must be one word.");
                if (!(editing.text ?? "").trim()) return setErr("Text is required.");
                await saveQuickReply({ id: editing.id ?? Math.random().toString(36).slice(2, 10), profile, shortcut, text: editing.text!.trim() });
                setEditing(null);
                setErr(null);
                refresh();
              }}
            >
              Save
            </Button>
            <Button variant="secondary" onClick={() => { setEditing(null); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setEditing({})}><Plus size={14} /> Add quick reply</Button>
      )}
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

// ── Backup & restore ─────────────────────────────────────────────────────

function BackupSection() {
  const qc = useQueryClient();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ path: string; backup: Backup } | null>(null);
  const [opts, setOpts] = useState<RestoreOptions>({ prefs: true, profiles: true, chatPrefs: true, quickReplies: true, schedules: true });

  return (
    <>
      <div className="space-y-2">
        <div className="text-sm font-medium">Export</div>
        <p className="text-xs text-neutral-500">Includes: preferences, servers, AI settings, pinned/muted/archived chats, quick replies, schedules (without attachments). Not included: message history, media cache, receipts.</p>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
          <span>
            Include API keys (WAHA + AI)
            <span className="block text-xs text-amber-700 dark:text-amber-300">Keys are written in plain text — keep the file private.</span>
          </span>
        </label>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={async () => {
            if (includeSecrets && !(await confirm({ title: "Export API keys in plain text?", message: "Anyone with the file can use your WAHA server and AI account.", danger: true, confirmLabel: "Export anyway" }))) return;
            setBusy("export");
            setMsg(null);
            try {
              const p = await exportBackup(includeSecrets);
              if (p) setMsg({ ok: true, text: `Saved to ${p}` });
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "export" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export backup…
        </Button>
      </div>

      <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-3">
        <div className="text-sm font-medium">Restore</div>
        {!pending ? (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={async () => {
              setMsg(null);
              try {
                const r = await pickBackup();
                if (r) setPending(r);
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
              }
            }}
          >
            <Upload size={14} /> Choose backup file…
          </Button>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-2">
            <div className="text-xs text-neutral-500 selectable truncate">{pending.path}</div>
            <div className="text-xs text-neutral-500">Exported {new Date(pending.backup.exportedAt).toLocaleString()} · app {pending.backup.appVersion} · {pending.backup.profiles?.length ?? 0} server(s) · {pending.backup.quickReplies?.length ?? 0} quick replies · {pending.backup.schedules?.length ?? 0} schedules{pending.backup.secrets ? " · includes API keys" : ""}</div>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {([["prefs", "Preferences & AI settings"], ["profiles", "Servers (merged by id)"], ["chatPrefs", "Pinned / muted / archived"], ["quickReplies", "Quick replies"], ["schedules", "Schedules"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}</label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy !== null}
                onClick={async () => {
                  if (!(await confirm({ title: "Restore this backup?", message: "Selected sections are merged into the current configuration. Existing items with the same id are overwritten.", confirmLabel: "Restore" }))) return;
                  setBusy("import");
                  try {
                    await restoreBackup(pending.backup, opts);
                    qc.clear();
                    setPending(null);
                    setMsg({ ok: true, text: "Restored. Some changes apply after the app is reopened." });
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Restore
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
      {msg && (
        <div className={"flex items-center gap-2 rounded-lg px-3 py-2 text-sm " + (msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300")}>
          {msg.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<span className="selectable break-all">{msg.text}</span>
        </div>
      )}
    </>
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

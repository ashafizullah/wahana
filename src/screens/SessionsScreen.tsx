import { useEffect, useState } from "react";
import { confirm } from "@/components/Confirm";
import { Loader2, Play, Square, RotateCw, LogOut, Trash2, Plus, RefreshCw, Pencil, UserPen, Webhook } from "lucide-react";
import { ProfileModal } from "@/components/ProfileModal";
import { WebhooksModal } from "@/components/WebhooksModal";
import { useSessions, useSessionAction, useServerVersion } from "@/api/queries";
import { useSettings } from "@/store/settings";
import { useWhatsApp } from "@/store/whatsapp";
import { nativeWa, type NativeAccount, type NativeWaStatus } from "@/lib/nativeWa";
import { Pairing } from "@/screens/whatsapp/Pairing";
import { Badge, Button, Input, Avatar } from "@/components/ui";
import type { SessionInfo, SessionStatus } from "@/api/types";
import { WahaError } from "@/api/client";
import { cn, errMsg } from "@/lib/utils";

const tone: Record<SessionStatus, "green" | "amber" | "red" | "neutral" | "blue"> = {
  WORKING: "green",
  STARTING: "amber",
  SCAN_QR_CODE: "blue",
  PASSKEY_REQUIRED: "blue",
  PASSKEY_CONFIRMATION_REQUIRED: "blue",
  STOPPED: "neutral",
  FAILED: "red",
};

export function SessionsScreen() {
  const { data: sessions, isLoading, error, refetch, isFetching } = useSessions();
  const { data: version } = useServerVersion();
  const act = useSessionAction();
  const { session: active, save, client } = useSettings();
  // A picked native account takes over the chat screen, so a WAHA session is only "active" without one.
  const nativeActive = useWhatsApp((s) => s.active);
  const setNativeActive = useWhatsApp((s) => s.setActive);
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: Parameters<typeof act.mutateAsync>[0]["action"], name: string) => {
    setActionError(null);
    try {
      await act.mutateAsync({ action, name });
      if (action === "create") setNewName("");
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold">Sessions</h1>
            {version && (
              <p className="text-sm text-neutral-500">
                WAHA {version.version} · {version.engine} · {version.tier}
              </p>
            )}
          </div>
          <Button variant="ghost" className="ml-auto" onClick={() => refetch()} title="Refresh">
            <RefreshCw size={16} className={cn(isFetching && "animate-spin")} />
          </Button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-3 py-2 text-sm selectable">
            {errMsg(error)}
          </div>
        )}
        {actionError && (
          <div className="rounded-lg bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-3 py-2 text-sm selectable">
            {actionError}
          </div>
        )}

        {isLoading && <Loader2 className="animate-spin text-neutral-400" />}

        <div className="space-y-3">
          {sessions?.map((s) => (
            <SessionCard
              key={s.name}
              session={s}
              active={s.name === active && !nativeActive}
              busy={act.isPending}
              onSelect={() => {
                setNativeActive(null);
                void save({ session: s.name });
              }}
              onAction={(a) => run(a, s.name)}
            />
          ))}
          {client && sessions?.length === 0 && <p className="text-sm text-neutral-500">No sessions yet. Create one below.</p>}
          {!client && <p className="text-sm text-neutral-500">No WAHA server configured. Add one in Settings to use WAHA sessions.</p>}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">WhatsApp accounts (no server)</h2>
          <NativeAccountsSection />
        </div>

        {client && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) run("create", newName.trim());
            }}
          >
            <Input placeholder="new session name (e.g. default)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={!newName.trim() || act.isPending}>
              <Plus size={16} /> Create & start
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session: s,
  active,
  busy,
  onSelect,
  onAction,
}: {
  session: SessionInfo;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onAction: (a: "start" | "stop" | "restart" | "logout" | "delete") => void;
}) {
  const running = s.status !== "STOPPED";
  const [profile, setProfile] = useState(false);
  const [webhooks, setWebhooks] = useState(false);
  const hookCount = s.config?.webhooks?.length ?? 0;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 bg-white dark:bg-neutral-900",
        active ? "border-wa-dark ring-1 ring-wa-dark/30" : "border-neutral-200 dark:border-neutral-800",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={s.me?.pushName ?? s.name} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{s.name}</span>
            <Badge tone={tone[s.status]}>{s.status}</Badge>
            {active && <Badge tone="green">active</Badge>}
          </div>
          {s.me && (
            <div className="text-xs text-neutral-500 truncate selectable">
              {s.me.pushName} · +{s.me.id.split("@")[0]}
            </div>
          )}
        </div>
        <div className="ml-auto flex gap-1">
          {s.status === "WORKING" && (
            <Button size="sm" variant="secondary" onClick={() => setProfile(true)} title="Edit my profile">
              <UserPen size={14} />
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setWebhooks(true)} title={`Webhooks (${hookCount})`}>
            <Webhook size={14} />
            {hookCount > 0 && <span className="text-[10px]">{hookCount}</span>}
          </Button>
          {!active && (
            <Button size="sm" variant="secondary" onClick={onSelect}>
              Use
            </Button>
          )}
          {!running ? (
            <Button size="sm" disabled={busy} onClick={() => onAction("start")} title="Start">
              <Play size={14} />
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction("stop")} title="Stop">
              <Square size={14} />
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction("restart")} title="Restart">
            <RotateCw size={14} />
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction("logout")} title="Logout">
            <LogOut size={14} />
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ title: `Delete session "${s.name}"?`, danger: true, confirmLabel: "Confirm" })) onAction("delete");
            }}
            title="Delete"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {s.status === "SCAN_QR_CODE" && <QrLogin session={s.name} />}
      {profile && <ProfileModal session={s.name} onClose={() => setProfile(false)} />}
      {webhooks && <WebhooksModal session={s} onClose={() => setWebhooks(false)} />}
    </div>
  );
}

const nativeTone: Record<NativeWaStatus, "green" | "amber" | "red" | "neutral" | "blue"> = {
  working: "green",
  starting: "amber",
  qr: "blue",
  stopped: "neutral",
  logged_out: "red",
  failed: "red",
};

/** Native accounts (no server): link, connect/disconnect, rename, logout, remove. */
function NativeAccountsSection() {
  const accounts = useWhatsApp((s) => s.accounts);
  const active = useWhatsApp((s) => s.active);
  const setActive = useWhatsApp((s) => s.setActive);
  const add = useWhatsApp((s) => s.add);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded-lg bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-3 py-2 text-sm selectable">{err}</div>
      )}
      {accounts.map((a) => (
        <NativeAccountCard key={a.id} account={a} active={a.id === active} onUse={() => setActive(a.id)} onError={setErr} />
      ))}
      {accounts.length === 0 && <p className="text-sm text-neutral-500">No WhatsApp account linked yet.</p>}
      <Button variant="secondary" onClick={() => void add().catch((e) => setErr(errMsg(e)))}>
        <Plus size={16} /> Link a WhatsApp account
      </Button>
    </div>
  );
}

function NativeAccountCard({
  account: a,
  active,
  onUse,
  onError,
}: {
  account: NativeAccount;
  active: boolean;
  onUse: () => void;
  onError: (e: string) => void;
}) {
  const remove = useWhatsApp((s) => s.remove);
  const rename = useWhatsApp((s) => s.rename);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError("");
    try {
      await fn();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const live = a.status === "working";
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 bg-white dark:bg-neutral-900",
        active ? "border-wa-dark ring-1 ring-wa-dark/30" : "border-neutral-200 dark:border-neutral-800",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar src={null} name={a.me?.pushName ?? a.name} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {editing ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => rename(a.id, name.trim() || a.name)).then(() => setEditing(false));
                }}
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setName(a.name);
                      setEditing(false);
                    }
                  }}
                  className="h-7 py-0.5"
                  autoFocus
                />
                <Button size="sm" type="submit">
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setName(a.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="font-semibold">{a.name}</span>
                <button
                  type="button"
                  title="Rename"
                  onClick={() => setEditing(true)}
                  className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  <Pencil size={13} />
                </button>
                <Badge tone={nativeTone[a.status]}>{a.status}</Badge>
                {active && <Badge tone="green">active</Badge>}
              </>
            )}
          </div>
          {a.me && (
            <div className="text-xs text-neutral-500 truncate selectable">
              {a.me.pushName} · +{a.me.id.split("@")[0]}
            </div>
          )}
        </div>
        <div className="ml-auto flex gap-1">
          {!live && a.status !== "qr" && a.status !== "starting" && !editing && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => nativeWa.start(a.id))} title="Connect">
              <Play size={14} />
            </Button>
          )}
          {live && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => nativeWa.stop(a.id))} title="Disconnect">
              <Square size={14} />
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy || editing} onClick={() => setEditing(true)} title="Rename">
            <UserPen size={14} />
          </Button>
          {!active && (
            <Button size="sm" variant="secondary" onClick={onUse}>
              Use
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => nativeWa.logout(a.id))} title="Logout">
            <LogOut size={14} />
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ title: `Remove "${a.name}"? Its local session is deleted.`, danger: true, confirmLabel: "Confirm" }))
                void run(() => remove(a.id));
            }}
            title="Remove"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {a.status === "qr" && <Pairing accountId={a.id} />}
    </div>
  );
}

function QrLogin({ session }: { session: string }) {
  const client = useSettings((s) => s.client);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let stop = false;
    let url: string | null = null;
    const load = async () => {
      try {
        const buf = await client.qrImage(session);
        if (stop) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        setSrc(url);
        setErr(null);
      } catch (e) {
        if (!stop) setErr(e instanceof WahaError ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, session]);

  return (
    <div className="flex gap-6 items-start border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <div className="w-56 h-56 bg-white rounded-lg grid place-items-center overflow-hidden">
        {src ? <img src={src} alt="QR" className="w-full h-full" /> : <Loader2 className="animate-spin text-neutral-400" />}
      </div>
      <div className="flex-1 space-y-3 text-sm">
        <p>
          Open WhatsApp → <b>Linked devices</b> → <b>Link a device</b> and scan the QR. It refreshes every 15s.
        </p>
        {err && <p className="text-red-600 selectable">{err}</p>}
        <div className="space-y-2">
          <p className="text-neutral-500">Or link with a phone number:</p>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await client!.requestPairingCode(session, phone.replace(/\D/g, ""));
                setCode(r.code);
              } catch (e) {
                setErr(errMsg(e));
              }
            }}
          >
            <Input placeholder="628123456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!phone}>
              Get code
            </Button>
          </form>
          {code && <p className="text-lg font-mono tracking-widest selectable">{code}</p>}
        </div>
      </div>
    </div>
  );
}

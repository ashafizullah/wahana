import { useEffect, useState } from "react";
import { Loader2, Play, Square, RotateCw, LogOut, Trash2, Plus, RefreshCw } from "lucide-react";
import { useSessions, useSessionAction, useServerVersion } from "@/api/queries";
import { useSettings } from "@/store/settings";
import { Badge, Button, Input, Avatar } from "@/components/ui";
import type { SessionInfo, SessionStatus } from "@/api/types";
import { WahaError } from "@/api/client";
import { cn } from "@/lib/utils";

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
  const { session: active, save } = useSettings();
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: Parameters<typeof act.mutateAsync>[0]["action"], name: string) => {
    setActionError(null);
    try {
      await act.mutateAsync({ action, name });
      if (action === "create") setNewName("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
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
            {error instanceof Error ? error.message : String(error)}
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
              active={s.name === active}
              busy={act.isPending}
              onSelect={() => save({ session: s.name })}
              onAction={(a) => run(a, s.name)}
            />
          ))}
          {sessions?.length === 0 && (
            <p className="text-sm text-neutral-500">No sessions yet. Create one below.</p>
          )}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) run("create", newName.trim());
          }}
        >
          <Input
            placeholder="new session name (e.g. default)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" disabled={!newName.trim() || act.isPending}>
            <Plus size={16} /> Create & start
          </Button>
        </form>
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
            onClick={() => {
              if (window.confirm(`Delete session "${s.name}"?`)) onAction("delete");
            }}
            title="Delete"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {s.status === "SCAN_QR_CODE" && <QrLogin session={s.name} />}
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
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Input placeholder="628123456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!phone}>
              Get code
            </Button>
          </form>
          {code && (
            <p className="text-lg font-mono tracking-widest selectable">{code}</p>
          )}
        </div>
      </div>
    </div>
  );
}

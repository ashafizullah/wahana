import { useState } from "react";
import { confirm } from "@/components/Confirm";
import { LogOut, Pencil, Play, Plus, Square, Trash2, UserPen } from "lucide-react";
import { useWhatsApp } from "@/store/whatsapp";
import { nativeWa, type NativeAccount, type NativeWaStatus } from "@/lib/nativeWa";
import { Pairing } from "@/screens/whatsapp/Pairing";
import { Avatar, Badge, Button, Input } from "@/components/ui";
import { cn, errMsg } from "@/lib/utils";

/** Linked WhatsApp accounts: link, connect/disconnect, rename, logout, remove. */
export function AccountsScreen() {
  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <NativeAccountsSection />
      </div>
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

/** Native accounts: link, connect/disconnect, rename, logout, remove. */
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

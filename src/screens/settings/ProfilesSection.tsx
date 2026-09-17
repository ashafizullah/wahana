import { useState } from "react";
import { confirm } from "@/components/Confirm";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { WahaClient } from "@/api/client";
import { Button, Input, Label } from "@/components/ui";
import { errMsg } from "@/lib/utils";

export function ProfilesSection() {
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
      setErr(errMsg(e));
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
              <span className="block text-xs text-neutral-500 truncate selectable">
                {p.baseUrl} · {p.session}
              </span>
            </span>
            {p.id !== activeProfile && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await switchProfile(p.id);
                  qc.clear();
                }}
              >
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
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" autoFocus />
          </div>
          <div>
            <Label>Base URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://waha.example.com" spellCheck={false} />
          </div>
          <div>
            <Label>API key</Label>
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex gap-2">
            <Button onClick={add} disabled={busy || !url || !key}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Test & add"}
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add server
        </Button>
      )}
    </>
  );
}

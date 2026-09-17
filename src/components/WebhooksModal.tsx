import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Webhook, X, Plus, Trash2, Loader2, Save } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Button, Input, Label } from "@/components/ui";
import { qk } from "@/api/queries";
import type { SessionInfo, WebhookConfig } from "@/api/types";
import { confirm } from "@/components/Confirm";
import { errMsg } from "@/lib/utils";

const ALL_EVENTS = ["message", "message.any", "message.ack", "message.reaction", "message.revoked", "message.edited", "message.waiting", "session.status", "state.change", "group.v2.join", "group.v2.leave", "group.v2.update", "group.v2.participants", "presence.update", "poll.vote", "chat.archive", "call.received", "call.accepted", "call.rejected", "label.upsert", "label.deleted", "label.chat.added", "label.chat.deleted", "event.response", "engine.event"];

interface Hook {
  url: string;
  events: string[];
  hmacKey: string;
  headers: { name: string; value: string }[];
}

function fromConfig(w: WebhookConfig): Hook {
  const raw = w as unknown as { url: string; events?: string[]; hmac?: { key?: string | null } | null; customHeaders?: { name: string; value: string }[] | null };
  return { url: raw.url, events: raw.events ?? [], hmacKey: raw.hmac?.key ?? "", headers: raw.customHeaders ?? [] };
}
function toConfig(h: Hook) {
  return {
    url: h.url.trim(),
    events: h.events,
    hmac: h.hmacKey ? { key: h.hmacKey } : null,
    retries: { delaySeconds: 2, attempts: 15, policy: "exponential" },
    customHeaders: h.headers.filter((x) => x.name.trim()).length ? h.headers.filter((x) => x.name.trim()) : null,
  };
}

/** Edit the webhooks of a session (`PUT /api/sessions/{name}` with the whole config). */
export function WebhooksModal({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const [hooks, setHooks] = useState<Hook[]>(() => (session.config?.webhooks ?? []).map(fromConfig));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (i: number, patch: Partial<Hook>) => setHooks((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const saveAll = async () => {
    if (!(await confirm({ title: "Apply webhook changes?", message: "WAHA restarts the session to apply a new config — it will be offline for a few seconds.", confirmLabel: "Apply" }))) return;
    setBusy(true);
    setErr(null);
    try {
      const config = { ...(session.config ?? {}), webhooks: hooks.filter((h) => h.url.trim()).map(toConfig) } as unknown as NonNullable<SessionInfo["config"]>;
      await requireClient().updateSessionConfig(session.name, config);
      qc.invalidateQueries({ queryKey: qk.sessions });
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[640px] max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Webhook size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">Webhooks · {session.name}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {hooks.length === 0 && <p className="text-sm text-neutral-500">No webhooks configured for this session.</p>}
          {hooks.map((h, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1"><Label>URL</Label><Input value={h.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://example.com/webhook" spellCheck={false} /></div>
                <button className="mt-4 text-neutral-400 hover:text-red-600" onClick={() => setHooks((hs) => hs.filter((_, j) => j !== i))} title="Remove"><Trash2 size={15} /></button>
              </div>
              <div>
                <Label>Events</Label>
                <div className="flex flex-wrap gap-1">
                  {ALL_EVENTS.map((ev) => {
                    const on = h.events.includes(ev);
                    return (
                      <button key={ev} onClick={() => update(i, { events: on ? h.events.filter((x) => x !== ev) : [...h.events, ev] })} className={"rounded-full px-2 py-0.5 text-[11px] " + (on ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300")}>
                        {ev}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>HMAC key (optional)</Label><Input value={h.hmacKey} onChange={(e) => update(i, { hmacKey: e.target.value })} placeholder="shared secret" /></div>
                <div>
                  <Label>Custom headers</Label>
                  {h.headers.map((hd, k) => (
                    <div key={k} className="flex gap-1 mb-1">
                      <Input placeholder="Name" value={hd.name} onChange={(e) => update(i, { headers: h.headers.map((x, m) => (m === k ? { ...x, name: e.target.value } : x)) })} />
                      <Input placeholder="Value" value={hd.value} onChange={(e) => update(i, { headers: h.headers.map((x, m) => (m === k ? { ...x, value: e.target.value } : x)) })} />
                      <button onClick={() => update(i, { headers: h.headers.filter((_, m) => m !== k) })}><X size={12} /></button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => update(i, { headers: [...h.headers, { name: "", value: "" }] })}><Plus size={12} /> header</Button>
                </div>
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setHooks((hs) => [...hs, { url: "", events: ["message", "session.status"], hmacKey: "", headers: [] }])}><Plus size={14} /> Add webhook</Button>
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={saveAll}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Apply</Button>
        </div>
      </div>
    </div>
  );
}

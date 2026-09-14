import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Plus, Play, Pause, Square, Trash2, Loader2, X, Users, Megaphone, Paperclip, RotateCcw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { useSettings } from "@/store/settings";
import { SessionSelect } from "@/components/SessionSelect";
import { useChats, useContacts } from "@/api/queries";
import { Avatar, Button, Input, Label } from "@/components/ui";
import { cn, displayId, fileToBase64, isChannel, isGroup } from "@/lib/utils";
import { confirm } from "@/components/Confirm";
import { createBroadcast, deleteBroadcast, listBroadcasts, listItems, retryFailed, setBroadcastStatus, type BroadcastSummary } from "@/store/broadcast";
import type { Kind } from "@/store/scheduler";
import { NotConnected } from "@/components/NotConnected";
import { GenerateButton } from "@/components/GenerateButton";

const fmt = (s: number) => new Date(s * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function BroadcastScreen() {
  const { client, activeProfile, session } = useSettings();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<BroadcastSummary | null>(null);
  const q = useQuery({ queryKey: ["broadcasts", activeProfile], queryFn: () => listBroadcasts(activeProfile), enabled: !!activeProfile, refetchInterval: 3000 });
  if (!client) return <NotConnected />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["broadcasts"] });

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-14 shrink-0 flex items-center gap-3 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <Radio size={18} className="text-wa-dark" />
        <div>
          <h1 className="font-semibold leading-tight">Broadcast</h1>
          <p className="text-[11px] text-neutral-500">One message to many recipients, sent one by one with a random pause. Use responsibly — WhatsApp bans spammy numbers.</p>
        </div>
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus size={14} /> New broadcast</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-2">
        {q.isLoading && <Loader2 className="animate-spin text-neutral-400" />}
        {q.data?.length === 0 && <p className="text-sm text-neutral-500">No broadcasts yet.</p>}
        {q.data?.map((b) => {
          const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
          return (
            <div key={b.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{b.name || "Untitled broadcast"}</span>
                    <span className="text-[10px] rounded-full bg-wa/15 text-wa-dark dark:text-wa px-1.5 py-0.5 font-mono" title="Session">{b.session}</span>
                    <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 capitalize", b.status === "running" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : b.status === "done" ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300")}>{b.status}</span>
                    {b.kind !== "text" && <span className="text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 flex items-center gap-1"><Paperclip size={10} />{b.kind}</span>}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">{b.text}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5 flex gap-3">
                    <span><CheckCircle2 size={11} className="inline text-emerald-600" /> {b.sent} sent</span>
                    {b.failed > 0 && <span><AlertTriangle size={11} className="inline text-red-600" /> {b.failed} failed</span>}
                    <span><Clock size={11} className="inline" /> {b.total - b.sent - b.failed} pending · {b.delay_min}–{b.delay_max}s pause</span>
                    <span>{fmt(b.created_at)}</span>
                  </div>
                </div>
                {(b.status === "draft" || b.status === "paused") && <Button size="sm" onClick={async () => { await setBroadcastStatus(b.id, "running"); refresh(); }}><Play size={12} /> {b.status === "draft" ? "Start" : "Resume"}</Button>}
                {b.status === "running" && <Button size="sm" variant="secondary" onClick={async () => { await setBroadcastStatus(b.id, "paused"); refresh(); }}><Pause size={12} /> Pause</Button>}
                {(b.status === "running" || b.status === "paused") && <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: "Cancel this broadcast?", message: "Pending recipients will not be sent.", danger: true, confirmLabel: "Cancel broadcast" })) { await setBroadcastStatus(b.id, "cancelled"); refresh(); } }}><Square size={12} /></Button>}
                {b.failed > 0 && b.status !== "running" && <Button size="sm" variant="secondary" title="Retry failed" onClick={async () => { await retryFailed(b.id); await setBroadcastStatus(b.id, "running"); refresh(); }}><RotateCcw size={12} /></Button>}
                <Button size="sm" variant="ghost" onClick={() => setOpen(b)}>Details</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { if (await confirm({ title: "Delete this broadcast and its log?", danger: true, confirmLabel: "Delete" })) { await deleteBroadcast(b.id); refresh(); } }}><Trash2 size={14} /></Button>
              </div>
              <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                <div className="h-full bg-wa-dark transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {creating && <NewBroadcast session={session} profile={activeProfile} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} />}
      {open && <BroadcastDetails b={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function NewBroadcast({ session, profile, onClose, onCreated }: { session: string; profile: string; onClose: () => void; onCreated: () => void }) {
  const [sess, setSess] = useState(session);
  const { data: chats } = useChats(sess);
  const { data: contacts } = useContacts(sess);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // id → name
  const [numbers, setNumbers] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(15);
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const t = q.trim().toLowerCase();
    const fromChats = (chats ?? []).filter((c) => c.id !== "status@broadcast").map((c) => ({ id: c.id, name: c.name || displayId(c.id), picture: c.picture }));
    const fromContacts = (contacts ?? []).filter((c) => (c.name || c.pushname) && c.id.endsWith("@c.us")).map((c) => ({ id: c.id, name: c.name || c.pushname || displayId(c.id), picture: null }));
    const seen = new Set<string>();
    return [...fromChats, ...fromContacts]
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .filter((c) => !t || c.name.toLowerCase().includes(t) || c.id.includes(t))
      .slice(0, 40);
  }, [chats, contacts, q]);

  const pastedNumbers = numbers.split(/[\s,;]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 8);
  const total = picked.size + pastedNumbers.filter((n) => !picked.has(`${n}@c.us`)).length;
  const kind: Kind = file ? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file") : "text";
  const valid = total > 0 && (text.trim() || file) && delayMin >= 1 && delayMax >= delayMin;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const id = Math.random().toString(36).slice(2, 12);
      const recipients = [...picked.entries()].map(([chatId, n]) => ({ chatId, name: n }));
      for (const n of pastedNumbers) if (!picked.has(`${n}@c.us`)) recipients.push({ chatId: `${n}@c.us`, name: `+${n}` });
      await createBroadcast(
        { id, profile, session: sess, name: name.trim() || null, kind, text: text.trim() || null, media_b64: file ? await fileToBase64(file) : null, media_mime: file?.type ?? null, media_name: file?.name ?? null, delay_min: delayMin, delay_max: delayMax },
        recipients,
      );
      if (startNow) await setBroadcastStatus(id, "running");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[720px] max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Radio size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">New broadcast</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div><Label>Name (for your list)</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo September" /></div>
              <div><Label>Send from (session)</Label><SessionSelect value={sess} onChange={(v) => { setSess(v); setPicked(new Map()); }} className="min-w-[180px]" /></div>
            </div>
            <div>
              <Label>Recipients · {total} selected</Label>
              <Input placeholder="Search chats & contacts" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
                {candidates.map((c) => {
                  const on = picked.has(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                      <input type="checkbox" checked={on} onChange={() => setPicked((p) => { const n = new Map(p); if (on) n.delete(c.id); else n.set(c.id, c.name); return n; })} />
                      <Avatar src={c.picture} name={c.name} size={24} />
                      <span className="flex-1 truncate">{c.name}</span>
                      {isChannel(c.id) ? <Megaphone size={12} className="text-neutral-400" /> : isGroup(c.id) ? <Users size={12} className="text-neutral-400" /> : null}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Or paste phone numbers (one per line / comma)</Label>
              <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={3} placeholder="628123456789&#10;628987654321" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none font-mono" />
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label>{file ? "Caption" : "Message"} · variables {"{name} {phone} {time} {date}"}</Label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="Halo {name}, …" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none" />
              <div className="flex items-center gap-2 mt-1.5">
                <GenerateButton kind="broadcast" text={text} onResult={setText} session={sess} />
                <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Paperclip size={12} /> {file ? "Change attachment" : "Attach"}</Button>
                {file && <span className="text-xs text-neutral-500 flex items-center gap-1">{file.name} <button onClick={() => setFile(null)}><X size={12} /></button></span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Min pause (s)</Label><Input type="number" min={1} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} /></div>
              <div><Label>Max pause (s)</Label><Input type="number" min={1} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} /></div>
            </div>
            <p className="text-[11px] text-neutral-500">Estimated duration: ~{Math.round((total * (delayMin + delayMax)) / 2 / 60)} min for {total} recipients. Keep pauses generous and lists small to protect your number.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start sending immediately</label>
            {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={create}>{busy ? <Loader2 size={14} className="animate-spin" /> : startNow ? "Create & start" : "Save draft"}</Button>
        </div>
      </div>
    </div>
  );
}

function BroadcastDetails({ b, onClose }: { b: BroadcastSummary; onClose: () => void }) {
  const q = useQuery({ queryKey: ["broadcast-items", b.id], queryFn: () => listItems(b.id), refetchInterval: b.status === "running" ? 2000 : false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] max-h-[75vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <span className="font-semibold flex-1 truncate">{b.name || "Broadcast"} · recipients</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800 text-sm">
          {q.data?.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-2">
              {it.status === "sent" ? <CheckCircle2 size={16} className="text-emerald-600" /> : it.status === "error" ? <AlertTriangle size={16} className="text-red-600" /> : <Clock size={16} className="text-neutral-400" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{it.name || displayId(it.chat_id)}</span>
                {it.error && <span className="block text-xs text-red-600 selectable">{it.error}</span>}
              </span>
              <span className="text-xs text-neutral-500">{it.sent_at ? fmt(it.sent_at) : it.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

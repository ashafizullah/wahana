import { useEffect, useRef, useState } from "react";
import { Paperclip, Image as ImageIcon, FileText, Mic, MapPin, Contact, BarChart3, X, Loader2, Square, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";

export type AttachKind = "image" | "file" | "voice" | "location" | "contact" | "poll";

/** Paperclip popover listing the attachment types. */
export function AttachMenu({ disabled, onPick }: { disabled?: boolean; onPick: (k: AttachKind) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const items: { k: AttachKind; icon: typeof Paperclip; label: string }[] = [
    { k: "image", icon: ImageIcon, label: "Photo / video" },
    { k: "file", icon: FileText, label: "Document" },
    { k: "voice", icon: Mic, label: "Voice message" },
    { k: "location", icon: MapPin, label: "Location" },
    { k: "contact", icon: Contact, label: "Contact" },
    { k: "poll", icon: BarChart3, label: "Poll" },
  ];

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} disabled={disabled} title="Attach">
        {disabled ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-sm z-20">
          {items.map((it) => (
            <button
              key={it.k}
              onClick={() => {
                setOpen(false);
                onPick(it.k);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <it.icon size={15} className="text-wa-dark" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dialog shell ─────────────────────────────────────────────────────────

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[400px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <span className="font-semibold flex-1">{title}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function ErrorLine({ err }: { err: string | null }) {
  return err ? <div className="text-xs text-red-600 selectable">{err}</div> : null;
}

/** Runs an async action with busy/error state; resolves true on success. */
async function guard(fn: () => Promise<void>, setBusy: (b: boolean) => void, setErr: (e: string | null) => void) {
  setBusy(true);
  setErr(null);
  try {
    await fn();
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    setBusy(false);
  }
}

// ── Voice recorder ───────────────────────────────────────────────────────

export function VoiceRecorder({ onSend, onClose }: { onSend: (blob: Blob, mime: string) => Promise<void>; onClose: () => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);

  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        setBlob(new Blob(chunks.current, { type: r.mimeType }));
        stream.current?.getTracks().forEach((t) => t.stop());
      };
      r.start(250);
      setRec(r);
      setSecs(0);
      setBlob(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void start();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rec || rec.state !== "recording") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);

  const recording = rec?.state === "recording";
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-sm">
      <span className={cn("w-2.5 h-2.5 rounded-full", recording ? "bg-red-500 animate-pulse" : "bg-neutral-400")} />
      <span className="font-mono">{mm}:{ss}</span>
      {blob && <audio controls src={URL.createObjectURL(blob)} className="h-8 max-w-[220px]" />}
      <span className="flex-1" />
      <ErrorLine err={err} />
      {recording ? (
        <Button size="sm" variant="secondary" onClick={() => rec?.stop()}>
          <Square size={12} /> Stop
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={start} disabled={busy}>
          <Mic size={12} /> Re-record
        </Button>
      )}
      <Button
        size="sm"
        disabled={!blob || busy}
        onClick={() => blob && guard(() => onSend(blob, blob.type), setBusy, setErr).then((ok) => ok && onClose())}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : "Send"}
      </Button>
      <button onClick={() => { rec?.state === "recording" && rec.stop(); onClose(); }} title="Cancel">
        <Trash2 size={16} className="text-neutral-500" />
      </button>
    </div>
  );
}

// ── Location ─────────────────────────────────────────────────────────────

export function LocationDialog({ onSend, onClose }: { onSend: (lat: number, lng: number, title: string) => Promise<void>; onClose: () => void }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsePaste = (v: string) => {
    // Accept "lat, lng" or a Google Maps URL with @lat,lng
    const m = v.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      setLat(m[1]!);
      setLng(m[2]!);
    }
  };

  const ok = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== "" && lng !== "";
  return (
    <Dialog title="Send location" onClose={onClose}>
      <div>
        <Label>Paste coordinates or Google Maps link</Label>
        <Input placeholder="-6.2000, 106.8166" onChange={(e) => parsePaste(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Latitude</Label><Input value={lat} onChange={(e) => setLat(e.target.value)} /></div>
        <div><Label>Longitude</Label><Input value={lng} onChange={(e) => setLng(e.target.value)} /></div>
      </div>
      <div><Label>Title (optional)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Office" /></div>
      <ErrorLine err={err} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok || busy} onClick={() => guard(() => onSend(Number(lat), Number(lng), title), setBusy, setErr).then((ok) => ok && onClose())}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Send"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Contact ──────────────────────────────────────────────────────────────

export function ContactDialog({ onSend, onClose }: { onSend: (name: string, phone: string, org: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = name.trim() && phone.replace(/\D/g, "").length >= 8;
  return (
    <Dialog title="Send contact" onClose={onClose}>
      <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div><Label>Phone (with country code)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="628123456789" /></div>
      <div><Label>Organization (optional)</Label><Input value={org} onChange={(e) => setOrg(e.target.value)} /></div>
      <ErrorLine err={err} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok || busy} onClick={() => guard(() => onSend(name.trim(), phone, org.trim()), setBusy, setErr).then((ok) => ok && onClose())}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Send"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Poll ─────────────────────────────────────────────────────────────────

export function PollDialog({ onSend, onClose }: { onSend: (name: string, options: string[], multiple: boolean) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clean = options.map((o) => o.trim()).filter(Boolean);
  const ok = name.trim() && clean.length >= 2 && clean.length <= 12;
  return (
    <Dialog title="Create poll" onClose={onClose}>
      <div><Label>Question</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div className="space-y-1.5">
        <Label>Options (2–12)</Label>
        {options.map((o, i) => (
          <div key={i} className="flex gap-1.5">
            <Input value={o} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
            {options.length > 2 && (
              <button onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}><X size={14} /></button>
            )}
          </div>
        ))}
        {options.length < 12 && (
          <Button size="sm" variant="ghost" onClick={() => setOptions((os) => [...os, ""])}><Plus size={12} /> Add option</Button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Allow multiple answers
      </label>
      <ErrorLine err={err} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok || busy} onClick={() => guard(() => onSend(name.trim(), clean, multiple), setBusy, setErr).then((ok) => ok && onClose())}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Send"}
        </Button>
      </div>
    </Dialog>
  );
}

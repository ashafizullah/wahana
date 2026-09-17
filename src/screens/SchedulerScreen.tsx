import { useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@/components/Confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  X,
  History,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Megaphone,
  Users,
  User,
  CircleDashed,
  Paperclip,
} from "lucide-react";
import { useSettings } from "@/store/settings";
import { useChats } from "@/api/queries";
import { Avatar, Button, Input, Label } from "@/components/ui";
import { cn, displayId, fileToBase64, isChannel, isGroup, errMsg } from "@/lib/utils";
import { stripWaMarkdown } from "@/lib/waMarkdown";
import {
  deleteSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  nextOccurrence,
  setEnabled,
  upsertSchedule,
  type Kind,
  type Repeat,
  type Schedule,
  type TargetType,
} from "@/store/scheduler";
import { GRACE_SECONDS } from "@/realtime/useScheduler";
import { SessionSelect } from "@/components/SessionSelect";
import { NotConnected } from "@/components/NotConnected";

const fmt = (s: number) =>
  new Date(s * 1000).toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SchedulerScreen() {
  const { client, activeProfile, session } = useSettings();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [history, setHistory] = useState<Schedule | null>(null);
  const q = useQuery({
    queryKey: ["schedules", activeProfile],
    queryFn: () => listSchedules(activeProfile),
    enabled: !!activeProfile,
    refetchInterval: 30_000,
  });

  if (!client) return <NotConnected />;
  const list = q.data ?? [];
  const upcoming = list.filter((s) => s.enabled);
  const paused = list.filter((s) => !s.enabled);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-14 shrink-0 flex items-center gap-3 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <CalendarClock size={18} className="text-wa-dark" />
        <div>
          <h1 className="font-semibold leading-tight">Scheduled messages</h1>
          <p className="text-[11px] text-neutral-500">
            Sent by this app while it is running (tray is fine). Jobs more than {GRACE_SECONDS / 60} min late are marked missed.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus size={14} /> New schedule
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {q.isLoading && <Loader2 className="animate-spin text-neutral-400" />}
        {q.error && <div className="text-sm text-red-600 selectable">{(q.error as Error).message}</div>}
        {!q.isLoading && list.length === 0 && (
          <div className="text-sm text-neutral-500">
            No schedules yet. Create one to send a message, story or channel post at a set time — once or on a repeat.
          </div>
        )}
        {upcoming.length > 0 && <Group title="Upcoming" items={upcoming} onEdit={setEditing} onHistory={setHistory} />}
        {paused.length > 0 && <Group title="Paused / done" items={paused} onEdit={setEditing} onHistory={setHistory} />}
      </div>
      {editing && (
        <ScheduleForm
          session={session}
          profile={activeProfile}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["schedules"] });
          }}
        />
      )}
      {history && <HistoryModal schedule={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function TargetIcon({ s }: { s: Schedule }) {
  if (s.target_type === "status") return <CircleDashed size={16} />;
  if (!s.target_id) return <User size={16} />;
  if (isChannel(s.target_id)) return <Megaphone size={16} />;
  if (isGroup(s.target_id)) return <Users size={16} />;
  return <User size={16} />;
}

function Group({
  title,
  items,
  onEdit,
  onHistory,
}: {
  title: string;
  items: Schedule[];
  onEdit: (s: Schedule) => void;
  onHistory: (s: Schedule) => void;
}) {
  const qc = useQueryClient();
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <ul className="space-y-2">
        {items.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3"
          >
            <div
              className={cn(
                "w-9 h-9 rounded-full grid place-items-center shrink-0",
                s.enabled ? "bg-wa-dark/10 text-wa-dark" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400",
              )}
            >
              <TargetIcon s={s} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">
                  {s.target_type === "status" ? "My status" : s.target_name || displayId(s.target_id ?? "")}
                </span>
                <span className="text-[10px] rounded-full bg-wa/15 text-wa-dark dark:text-wa px-1.5 py-0.5 font-mono" title="Session">
                  {s.session}
                </span>
                <span className="text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 capitalize">
                  {s.repeat}
                  {s.repeat === "weekly" && s.weekdays
                    ? ` · ${s.weekdays
                        .split(",")
                        .map((d) => DAYS[Number(d)])
                        .join(" ")}`
                    : ""}
                </span>
                {s.kind !== "text" && (
                  <span className="text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                    <Paperclip size={10} />
                    {s.kind}
                  </span>
                )}
              </div>
              <div className="text-xs text-neutral-500 truncate">{s.text ? stripWaMarkdown(s.text) : `(${s.kind})`}</div>
              <div className="text-[11px] mt-0.5 flex items-center gap-2">
                <span className="flex items-center gap-1 text-neutral-600 dark:text-neutral-300">
                  <Clock size={11} /> {s.enabled ? `Next ${fmt(s.next_run)}` : s.last_run ? `Last ${fmt(s.last_run)}` : fmt(s.next_run)}
                </span>
                {s.last_status === "ok" && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 size={11} /> sent {s.runs}×
                  </span>
                )}
                {s.last_status === "error" && (
                  <span className="flex items-center gap-1 text-red-600" title={s.last_error ?? ""}>
                    <AlertTriangle size={11} /> failed
                  </span>
                )}
                {s.last_status === "missed" && (
                  <span className="flex items-center gap-1 text-amber-600" title={s.last_error ?? ""}>
                    <AlertTriangle size={11} /> missed
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="ghost" title="History" onClick={() => onHistory(s)}>
              <History size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={s.enabled ? "Pause" : "Resume"}
              onClick={async () => {
                await setEnabled(s.id, !s.enabled);
                qc.invalidateQueries({ queryKey: ["schedules"] });
              }}
            >
              {s.enabled ? <Pause size={14} /> : <Play size={14} />}
            </Button>
            <Button size="sm" variant="ghost" title="Edit" onClick={async () => onEdit((await getSchedule(s.id)) ?? s)}>
              <Pencil size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              title="Delete"
              onClick={async () => {
                if (await confirm({ title: "Delete this schedule?", danger: true, confirmLabel: "Confirm" })) {
                  await deleteSchedule(s.id);
                  qc.invalidateQueries({ queryKey: ["schedules"] });
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Form ─────────────────────────────────────────────────────────────────

function toLocalInput(unix: number) {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ScheduleForm({
  session,
  profile,
  initial,
  onClose,
  onSaved,
}: {
  session: string;
  profile: string;
  initial: Schedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sess, setSess] = useState(initial?.session ?? session);
  const { data: chats } = useChats(sess);
  const [targetType, setTargetType] = useState<TargetType>(initial?.target_type ?? "chat");
  const [targetId, setTargetId] = useState(initial?.target_id ?? "");
  const [targetName, setTargetName] = useState(initial?.target_name ?? "");
  const [q, setQ] = useState("");
  const [text, setText] = useState(initial?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepMedia, setKeepMedia] = useState(!!initial?.media_name);
  const [when, setWhen] = useState(toLocalInput(initial?.next_run ?? Math.floor(Date.now() / 1000) + 3600));
  const [repeat, setRepeat] = useState<Repeat>(initial?.repeat ?? "once");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ? initial.weekdays.split(",").map(Number) : [new Date().getDay()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (chats ?? [])
      .filter((c) => c.id !== "status@broadcast")
      .filter((c) => !term || (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term))
      .slice(0, 30);
  }, [chats, q]);

  const kind: Kind = file
    ? file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "file"
    : keepMedia && initial
      ? initial.kind
      : "text";
  const whenUnix = Math.floor(new Date(when).getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);
  const inPast = Number.isFinite(whenUnix) && whenUnix <= nowUnix;
  const valid =
    (targetType === "status" || targetId) &&
    (text.trim() || file || keepMedia) &&
    Number.isFinite(whenUnix) &&
    (repeat !== "weekly" || weekdays.length > 0) &&
    !(targetType === "status" && kind === "file") &&
    !(repeat === "once" && inPast);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      let firstRun = whenUnix;
      const now = Math.floor(Date.now() / 1000);
      if (repeat === "once" && firstRun <= now) throw new Error("That time has already passed — pick a time in the future.");
      if (repeat !== "once" && firstRun <= now)
        firstRun = nextOccurrence({ next_run: whenUnix, repeat, weekdays: weekdays.join(",") }, now) ?? whenUnix;
      await upsertSchedule({
        id: initial?.id ?? Math.random().toString(36).slice(2, 12),
        profile,
        session: sess,
        target_type: targetType,
        target_id: targetType === "status" ? null : targetId,
        target_name: targetType === "status" ? null : targetName || null,
        kind,
        text: text.trim() || null,
        media_b64: file ? await fileToBase64(file) : null, // null keeps the existing media on edit
        media_mime: file ? file.type || "application/octet-stream" : null,
        media_name: file ? file.name : null,
        next_run: firstRun,
        anchor: whenUnix,
        repeat,
        weekdays: repeat === "weekly" ? [...weekdays].sort().join(",") : null,
        enabled: 1,
        created_at: initial?.created_at,
      });
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[560px] max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <CalendarClock size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">{initial ? "Edit schedule" : "New schedule"}</span>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <Label>Send from (session)</Label>
            <SessionSelect
              value={sess}
              onChange={(v) => {
                setSess(v);
                setTargetId("");
                setTargetName("");
              }}
              className="w-full"
            />
          </div>
          <div>
            <Label>Send to</Label>
            <div className="flex gap-1 mb-2">
              <Button size="sm" variant={targetType === "chat" ? "primary" : "secondary"} onClick={() => setTargetType("chat")}>
                Contact / group / channel
              </Button>
              <Button size="sm" variant={targetType === "status" ? "primary" : "secondary"} onClick={() => setTargetType("status")}>
                <CircleDashed size={12} /> My status
              </Button>
            </div>
            {targetType === "chat" && (
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-700">
                {targetId ? (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Avatar name={targetName || displayId(targetId)} size={28} />
                    <span className="flex-1 truncate text-sm">
                      {targetName || displayId(targetId)} <span className="text-xs text-neutral-500">{targetId}</span>
                    </span>
                    <button
                      onClick={() => {
                        setTargetId("");
                        setTargetName("");
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      className="border-0 rounded-b-none"
                      placeholder="Search chats, groups, channels…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      autoFocus
                    />
                    <div className="max-h-40 overflow-y-auto border-t border-neutral-100 dark:border-neutral-800">
                      {candidates.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setTargetId(c.id);
                            setTargetName(c.name ?? "");
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <Avatar src={c.picture} name={c.name || displayId(c.id)} size={26} />
                          <span className="flex-1 truncate">{c.name || displayId(c.id)}</span>
                          {isChannel(c.id) ? (
                            <Megaphone size={12} className="text-neutral-400" />
                          ) : isGroup(c.id) ? (
                            <Users size={12} className="text-neutral-400" />
                          ) : null}
                        </button>
                      ))}
                      {q.trim() && /^\+?\d{8,}$/.test(q.trim()) && (
                        <button
                          onClick={() => {
                            const d = q.replace(/\D/g, "");
                            setTargetId(`${d}@c.us`);
                            setTargetName("");
                          }}
                          className="w-full px-3 py-1.5 text-left text-sm text-wa-dark hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Use number +{q.replace(/\D/g, "")}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>{file || keepMedia ? "Caption" : "Message"}</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Supports WhatsApp formatting: *bold* _italic_ ~strike~"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <input
                ref={fileRef}
                type="file"
                hidden
                accept={targetType === "status" ? "image/*,video/*" : undefined}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setKeepMedia(false);
                }}
              />
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                <Paperclip size={12} /> {file || keepMedia ? "Change attachment" : "Attach photo / video / file"}
              </Button>
              {(file || keepMedia) && (
                <span className="text-xs text-neutral-500 flex items-center gap-1">
                  {file?.name ?? initial?.media_name}{" "}
                  <button
                    onClick={() => {
                      setFile(null);
                      setKeepMedia(false);
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{repeat === "once" ? "When" : "First run / time of day"}</Label>
              <Input
                type="datetime-local"
                value={when}
                min={toLocalInput(nowUnix)}
                onChange={(e) => setWhen(e.target.value)}
                className={cn(repeat === "once" && inPast && "border-red-500")}
              />
              {repeat === "once" && inPast && <div className="text-[11px] text-red-600 mt-1">This time has already passed.</div>}
            </div>
            <div>
              <Label>Repeat</Label>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Repeat)}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none"
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly (same day)</option>
              </select>
            </div>
          </div>
          {repeat === "weekly" && (
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                  className={cn(
                    "flex-1 rounded-lg py-1 text-xs font-medium",
                    weekdays.includes(i) ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {Number.isFinite(whenUnix) && (
            <p className="text-xs text-neutral-500">
              {repeat === "once"
                ? inPast
                  ? ""
                  : `Will send ${fmt(whenUnix)}.`
                : `Next run ${fmt(whenUnix > Date.now() / 1000 ? whenUnix : (nextOccurrence({ next_run: whenUnix, repeat, weekdays: weekdays.join(",") }, Math.floor(Date.now() / 1000)) ?? whenUnix))}, then ${repeat}.`}
            </p>
          )}
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={save}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : initial ? "Save" : "Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const q = useQuery({ queryKey: ["schedule-runs", schedule.id], queryFn: () => listRuns(schedule.id) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[480px] max-h-[70vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <History size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1 truncate">
            History · {schedule.target_type === "status" ? "My status" : schedule.target_name || schedule.target_id}
          </span>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800 text-sm">
          {q.isLoading && (
            <li className="p-4">
              <Loader2 className="animate-spin text-neutral-400" />
            </li>
          )}
          {q.data?.length === 0 && <li className="p-6 text-center text-neutral-500">Not run yet.</li>}
          {q.data?.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-2">
              {r.status === "ok" ? (
                <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className={cn("mt-0.5", r.status === "missed" ? "text-amber-600" : "text-red-600")} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block">
                  {fmt(r.ran_at)} · <span className="capitalize">{r.status}</span>
                </span>
                {r.error && <span className="block text-xs text-neutral-500 selectable">{r.error}</span>}
                {r.message_id && <span className="block text-[10px] font-mono text-neutral-400 selectable truncate">{r.message_id}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

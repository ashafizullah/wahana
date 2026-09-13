import { useEffect, useMemo, useState } from "react";
import { Sparkles, X, Loader2, Copy, Check, RefreshCw, ListChecks, AlarmClock, Send } from "lucide-react";
import { useSessions } from "@/api/queries";
import { upsertSchedule } from "@/store/scheduler";
import { extractTasks, type ExtractedTask } from "@/lib/ai";
import { Button } from "@/components/ui";
import { WaMarkdown, stripWaMarkdown } from "@/lib/waMarkdown";
import type { MentionResolver } from "@/lib/waMarkdown";
import { transcript } from "@/lib/exportChat";
import { LANGUAGES, aiConfigured, summarizeChat } from "@/lib/ai";
import { useSettings } from "@/store/settings";
import type { WAMessage } from "@/api/types";
import { isGroup } from "@/lib/utils";

type ScopeId = "unread" | "today" | "yesterday" | "50" | "100" | "300" | "all";

interface Result {
  scope: ScopeId;
  question: string;
  count: number;
  text: string;
}
/** Last result per chat so reopening the dialog doesn't re-spend tokens. In-memory only. */
const lastResult = new Map<string, Result>();
const lastTasks = new Map<string, { scope: ScopeId; count: number; tasks: ExtractedTask[] }>();

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Default reminder time: the due time if it's still ahead, else tomorrow 09:00. */
function defaultWhen(due?: string | null) {
  if (due) {
    const d = new Date(due);
    if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 60_000) return toLocalInput(d);
  }
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return toLocalInput(t);
}

const startOfDay = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);

/** "Summarize this chat" dialog: pick a range of the loaded messages, optionally ask a question, get a WhatsApp-formatted answer. */
export function SummaryModal({
  session,
  chatId,
  chatName,
  messages,
  resolve,
  seenAt,
  hasMore,
  onLoadOlder,
  onClose,
}: {
  session: string;
  chatId: string;
  chatName: string;
  /** Loaded messages, oldest first. */
  messages: WAMessage[];
  resolve: MentionResolver;
  /** When the chat was last opened before now (unix s), for "since I last read". */
  seenAt?: number;
  hasMore: boolean;
  onLoadOlder: () => Promise<void> | void;
  onClose: () => void;
}) {
  const key = `${session}:${chatId}`;
  const prev = lastResult.get(key);
  const defaultLang = useSettings((s) => s.aiTranslateTo);
  const [scope, setScope] = useState<ScopeId>(prev?.scope ?? "100");
  const [question, setQuestion] = useState(prev?.question ?? "");
  const [lang, setLang] = useState(defaultLang);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(prev ?? null);
  const [copied, setCopied] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mode, setMode] = useState<"summary" | "tasks">("summary");
  const [tasks, setTasks] = useState(lastTasks.get(key) ?? null);
  const [tasksBusy, setTasksBusy] = useState(false);
  const profile = useSettings((s) => s.activeProfile);
  const { data: sessions } = useSessions();
  const me = sessions?.find((x) => x.name === session)?.me;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usable = useMemo(() => messages.filter((m) => !(m as WAMessage & { waiting?: boolean }).waiting && (m.body || m.hasMedia)), [messages]);
  const scopes = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = today - 86400;
    const since = (t: number) => usable.filter((m) => m.timestamp >= t);
    const last = (n: number) => usable.slice(-n);
    const list: { id: ScopeId; label: string; msgs: WAMessage[] }[] = [];
    if (seenAt) list.push({ id: "unread", label: "Since I last read", msgs: usable.filter((m) => m.timestamp > seenAt) });
    list.push({ id: "today", label: "Today", msgs: since(today) });
    list.push({ id: "yesterday", label: "Since yesterday", msgs: since(yesterday) });
    for (const n of [50, 100, 300] as const) list.push({ id: String(n) as ScopeId, label: `Last ${n}`, msgs: last(n) });
    list.push({ id: "all", label: `All loaded`, msgs: usable });
    return list;
  }, [usable, seenAt]);
  const selected = scopes.find((s) => s.id === scope) ?? scopes[scopes.length - 1]!;
  const ready = aiConfigured();

  const run = async () => {
    if (!selected.msgs.length) return;
    setBusy(true);
    setErr(null);
    try {
      const text = await summarizeChat(transcript(selected.msgs, resolve), { chatName, isGroup: isGroup(chatId), language: lang, question: question.trim() || undefined });
      const r: Result = { scope, question: question.trim(), count: selected.msgs.length, text };
      lastResult.set(key, r);
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTasks = async () => {
    if (!selected.msgs.length) return;
    setTasksBusy(true);
    setErr(null);
    try {
      const list = await extractTasks(transcript(selected.msgs, resolve), { chatName, language: lang });
      const r = { scope, count: selected.msgs.length, tasks: list };
      lastTasks.set(key, r);
      setTasks(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTasksBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(stripWaMarkdown(result.text));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[600px] max-w-[95vw] max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Sparkles size={16} className="text-wa-dark" />
          <span className="font-semibold truncate">{chatName}</span>
          <div className="ml-2 flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5 text-xs">
            {([["summary", "Summary", Sparkles], ["tasks", "Tasks & dates", ListChecks]] as const).map(([id, label, Icon]) => (
              <button key={id} onClick={() => setMode(id)} className={"inline-flex items-center gap-1 rounded-md px-2 py-1 " + (mode === id ? "bg-white dark:bg-neutral-900 shadow font-medium" : "text-neutral-500")}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-3 space-y-2 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                disabled={!s.msgs.length}
                className={
                  "rounded-full px-2.5 py-1 text-xs border transition disabled:opacity-40 " +
                  (s.id === selected.id
                    ? "bg-wa-dark text-white border-wa-dark"
                    : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800")
                }
              >
                {s.label} <span className="opacity-70">({s.msgs.length})</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {mode === "tasks" && <span className="flex-1 text-xs text-neutral-500">Finds promises, deadlines, meetings and bills — then turn any of them into a scheduled reminder.</span>}
            {mode === "summary" && <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void run()}
              placeholder="Optional question, e.g. “What did they decide about the deadline?”"
              className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-wa-dark"
            />}
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-xs outline-none" title="Output language">
              {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            {mode === "summary" ? (
              <Button onClick={run} disabled={!ready || busy || !selected.msgs.length} title={ready ? "" : "Set up AI in Settings first"}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                {question.trim() ? "Ask" : "Summarize"}
              </Button>
            ) : (
              <Button onClick={runTasks} disabled={!ready || tasksBusy || !selected.msgs.length} title={ready ? "" : "Set up AI in Settings first"}>
                {tasksBusy ? <Loader2 size={14} className="animate-spin" /> : tasks ? <RefreshCw size={14} /> : <ListChecks size={14} />} Find tasks
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span>Only loaded messages are included{hasMore ? " — scroll up or load older to include more." : "."}</span>
            {hasMore && (
              <button
                className="underline disabled:opacity-50"
                disabled={loadingOlder}
                onClick={async () => { setLoadingOlder(true); try { await onLoadOlder(); } finally { setLoadingOlder(false); } }}
              >
                {loadingOlder ? "Loading…" : "Load older"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {!ready && <div className="text-neutral-500">Set up an AI provider in Settings → AI to use summaries.</div>}
          {err && <div className="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2 mb-2">{err}</div>}
          {mode === "tasks" && ready && (
            tasksBusy && !tasks ? <div className="flex items-center gap-2 text-neutral-500"><Loader2 size={14} className="animate-spin" /> Reading {selected.msgs.length} messages…</div>
            : !tasks ? <div className="text-neutral-500">Pick a range and press Find tasks.</div>
            : tasks.tasks.length === 0 ? <div className="text-neutral-500">No tasks or dates found in {tasks.count} messages.</div>
            : (
              <ul className={"space-y-2 " + (tasksBusy ? "opacity-50" : "")}>
                {tasks.tasks.map((t, i) => (
                  <TaskRow key={i} task={t} session={session} chatId={chatId} chatName={chatName} profile={profile} meId={me?.id} />
                ))}
              </ul>
            )
          )}
          {mode === "summary" && busy && !result && <div className="flex items-center gap-2 text-neutral-500"><Loader2 size={14} className="animate-spin" /> Reading {selected.msgs.length} messages…</div>}
          {mode === "summary" && result && (
            <div className={busy ? "opacity-50" : ""}>
              <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-2">
                <span>{result.count} messages{result.question ? ` · “${result.question}”` : ""}</span>
                <button onClick={copy} className="ml-auto inline-flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200">
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="whitespace-pre-wrap break-words leading-relaxed"><WaMarkdown text={result.text} /></div>
            </div>
          )}
          {mode === "summary" && !result && !busy && ready && <div className="text-neutral-500">Pick a range and press Summarize, or type a question about this chat.</div>}
        </div>
      </div>
    </div>
  );
}

/** One extracted task with a reminder time and two ways to schedule it (to myself, or into this chat). */
function TaskRow({ task, session, chatId, chatName, profile, meId }: { task: ExtractedTask; session: string; chatId: string; chatName: string; profile: string; meId?: string }) {
  const [when, setWhen] = useState(() => defaultWhen(task.due));
  const [done, setDone] = useState<"me" | "chat" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const schedule = async (to: "me" | "chat") => {
    const at = Math.floor(new Date(when).getTime() / 1000);
    if (!at || at <= Date.now() / 1000) { setErr("Pick a time in the future."); return; }
    if (to === "me" && !meId) { setErr("Your own number is unknown for this session."); return; }
    setBusy(true);
    setErr(null);
    try {
      const line = [task.title, task.who && task.who !== "You" ? `(${task.who})` : "", task.detail ? `— ${task.detail}` : ""].filter(Boolean).join(" ");
      await upsertSchedule({
        id: Math.random().toString(36).slice(2, 12),
        profile,
        session,
        target_type: "chat",
        target_id: to === "me" ? meId! : chatId,
        target_name: to === "me" ? "Me" : chatName,
        kind: "text",
        text: to === "me" ? `⏰ Reminder (${chatName}): ${line}` : `⏰ Reminder: ${line}`,
        media_b64: null,
        media_mime: null,
        media_name: null,
        next_run: at,
        repeat: "once",
        weekdays: null,
        enabled: 1,
      });
      setDone(to);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2">
      <div className="font-medium">{task.title}</div>
      {(task.who || task.detail) && <div className="text-xs text-neutral-500">{[task.who, task.detail].filter(Boolean).join(" · ")}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <AlarmClock size={12} className="text-neutral-400" />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none" />
        {!task.due && <span className="text-neutral-400">(no date in chat)</span>}
        <span className="flex-1" />
        {done ? (
          <span className="inline-flex items-center gap-1 text-wa-dark"><Check size={12} /> Scheduled {done === "me" ? "to me" : "to chat"} · edit in Scheduler</span>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void schedule("me")} title="Message to my own number at that time"><AlarmClock size={12} /> Remind me</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void schedule("chat")} title="Message into this chat at that time"><Send size={12} /> Send to chat</Button>
          </>
        )}
      </div>
      {err && <div className="text-xs text-red-600 mt-1 selectable">{err}</div>}
    </li>
  );
}

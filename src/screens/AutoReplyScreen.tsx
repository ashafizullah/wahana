import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Trash2, Pencil, Loader2, X, Play, Pause, AlertTriangle, CheckCircle2, Sparkles, MessageSquareText, Clock, Users, User, Globe, ListChecks } from "lucide-react";
import { confirm } from "@/components/Confirm";
import { useSettings } from "@/store/settings";
import { useChats } from "@/api/queries";
import { SessionSelect } from "@/components/SessionSelect";
import { Avatar, Badge, Button, Input, Label } from "@/components/ui";
import { cn, displayId, isGroup } from "@/lib/utils";
import { aiConfigured } from "@/lib/ai";
import { aiAutoReply, sampleMessage } from "@/lib/autoReplyAi";
import { NotConnected } from "@/components/NotConnected";
import {
  clearLog, deleteRule, inWindow, listLog, listRules, setRuleEnabled, textMatches, upsertRule,
  type AutoReplyLog, type AutoReplyRule, type MatchKind, type ReplyKind, type Scope,
} from "@/store/autoReply";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (s: number) => new Date(s * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const SCOPE_LABEL: Record<Scope, string> = { dm: "All direct messages", groups: "All groups", all: "Everyone", chats: "Specific chats / groups" };

export function AutoReplyScreen() {
  const { client, activeProfile, session, autoReplyPaused, autoReplyDailyLimit, save } = useSettings();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AutoReplyRule | "new" | null>(null);
  const rules = useQuery({ queryKey: ["auto-reply", "rules", activeProfile], queryFn: () => listRules(activeProfile), enabled: !!activeProfile });
  const log = useQuery({ queryKey: ["auto-reply", "log", activeProfile], queryFn: () => listLog(activeProfile), enabled: !!activeProfile, refetchInterval: 15_000 });

  if (!client) return <NotConnected />;
  const list = rules.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["auto-reply"] });

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-14 shrink-0 flex items-center gap-3 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <Bot size={18} className="text-wa-dark" />
        <div>
          <h1 className="font-semibold leading-tight">Auto-reply</h1>
          <p className="text-[11px] text-neutral-500">Answers incoming messages while this app is running. First matching rule wins; one reply per chat per cooldown; stays quiet for 15 min in chats you answered yourself.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500" title="Spend guard: replies sent per day across all rules of this server (0 = unlimited)">
            Max / day
            <input
              type="number"
              min={0}
              step={50}
              value={autoReplyDailyLimit}
              onChange={(e) => save({ autoReplyDailyLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              className="w-16 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-800 dark:text-neutral-100 outline-none focus:border-wa-dark"
            />
          </label>
          <Button size="sm" variant={autoReplyPaused ? "danger" : "secondary"} title="Kill switch for every rule" onClick={() => save({ autoReplyPaused: !autoReplyPaused })}>
            {autoReplyPaused ? <><Play size={12} /> Paused — resume</> : <><Pause size={12} /> Pause all</>}
          </Button>
          <Button onClick={() => setEditing("new")}><Plus size={14} /> New rule</Button>
        </div>
      </div>
      {autoReplyPaused && (
        <div className="shrink-0 px-6 py-2 text-xs bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 flex items-center gap-2"><AlertTriangle size={12} /> All auto-replies are paused.</div>
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {rules.isLoading && <Loader2 className="animate-spin text-neutral-400" />}
        {!rules.isLoading && list.length === 0 && (
          <div className="text-sm text-neutral-500">No rules yet. Create one to answer automatically — a fixed text (out of office, opening hours) or an AI reply that follows your instructions (FAQ, prices, tone).</div>
        )}
        {[...new Set(list.map((r) => r.session))].map((sess) => (
          <section key={sess} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 flex items-center gap-2">
              Session <span className="normal-case tracking-normal font-mono text-neutral-700 dark:text-neutral-200">{sess}</span>
              {sess === session && <Badge tone="blue">current</Badge>}
            </h2>
            <ul className="space-y-2">
              {list.filter((r) => r.session === sess).map((r) => <RuleRow key={r.id} r={r} onEdit={() => setEditing(r)} onChanged={invalidate} />)}
            </ul>
          </section>
        ))}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent replies</h2>
            {(log.data?.length ?? 0) > 0 && <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={async () => { await clearLog(activeProfile); invalidate(); }}>Clear</Button>}
          </div>
          {(log.data?.length ?? 0) === 0 ? (
            <div className="text-xs text-neutral-500">Nothing sent yet.</div>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              {log.data!.map((l) => <LogRow key={l.id} l={l} ruleName={list.find((r) => r.id === l.rule_id)?.name ?? "(deleted rule)"} />)}
            </ul>
          )}
        </section>
      </div>
      {editing && (
        <RuleForm
          session={session}
          profile={activeProfile}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function RuleRow({ r, onEdit, onChanged }: { r: AutoReplyRule; onEdit: () => void; onChanged: () => void }) {
  const live = !!r.enabled && inWindow(r);
  const ScopeIcon = r.scope === "groups" ? Users : r.scope === "dm" ? User : r.scope === "chats" ? ListChecks : Globe;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className={cn("w-9 h-9 rounded-full grid place-items-center shrink-0", r.enabled ? "bg-wa-dark/10 text-wa-dark" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400")}>
        {r.reply_kind === "ai" ? <Sparkles size={16} /> : <MessageSquareText size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{r.name}</span>
          <Badge tone={r.enabled ? (live ? "green" : "amber") : "neutral"}>{r.enabled ? (live ? "active now" : "outside hours") : "paused"}</Badge>
          <span className="text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 flex items-center gap-1"><ScopeIcon size={10} />{SCOPE_LABEL[r.scope]}</span>
        </div>
        <div className="text-xs text-neutral-500 truncate">
          {r.match_kind === "any" ? "Any message" : r.match_kind === "keywords" ? `Keywords: ${r.pattern}` : `Regex: ${r.pattern}`}
          {" → "}
          {r.reply_kind === "ai" ? "AI reply" : (r.text ?? "").replace(/\s+/g, " ")}
        </div>
        <div className="text-[11px] mt-0.5 flex items-center gap-3 text-neutral-600 dark:text-neutral-300">
          <span className="flex items-center gap-1"><Clock size={11} />{r.hours_from && r.hours_to ? `${r.hours_from}–${r.hours_to}` : "any time"}{r.weekdays ? ` · ${r.weekdays.split(",").map((d) => DAYS[Number(d)]).join(" ")}` : ""}</span>
          <span>cooldown {r.cooldown_min ? `${r.cooldown_min} min` : "off"}</span>
          {r.replies > 0 && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={11} /> {r.replies}× {r.last_run ? `· last ${fmt(r.last_run)}` : ""}</span>}
        </div>
      </div>
      <Button size="sm" variant="ghost" title={r.enabled ? "Pause" : "Resume"} onClick={async () => { await setRuleEnabled(r.id, !r.enabled); onChanged(); }}>
        {r.enabled ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <Button size="sm" variant="ghost" title="Edit" onClick={onEdit}><Pencil size={14} /></Button>
      <Button size="sm" variant="ghost" className="text-red-600" title="Delete" onClick={async () => { if (await confirm({ title: `Delete rule “${r.name}”?`, message: "Its reply history is deleted too.", danger: true, confirmLabel: "Delete" })) { await deleteRule(r.id); onChanged(); } }}><Trash2 size={14} /></Button>
    </li>
  );
}

function LogRow({ l, ruleName }: { l: AutoReplyLog; ruleName: string }) {
  return (
    <li className="px-4 py-2 text-xs flex gap-3">
      <span className="shrink-0 text-neutral-500 w-24">{fmt(l.at)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="font-medium truncate">{l.chat_name || displayId(l.chat_id)}</span><span className="text-neutral-500 truncate">· {ruleName}</span></div>
        {l.incoming && <div className="text-neutral-500 truncate">« {l.incoming}</div>}
        {l.status === "sent" ? <div className="truncate selectable">» {l.reply}</div> : <div className="text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {l.error}</div>}
      </div>
    </li>
  );
}

// ── Form ─────────────────────────────────────────────────────────────────

function RuleForm({ session, profile, initial, onClose, onSaved }: { session: string; profile: string; initial: AutoReplyRule | null; onClose: () => void; onSaved: () => void }) {
  const [sess, setSess] = useState(initial?.session ?? session);
  const { data: chats } = useChats(sess);
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "dm");
  const [chatIds, setChatIds] = useState<string[]>(() => { try { return JSON.parse(initial?.chat_ids ?? "[]"); } catch { return []; } });
  const [q, setQ] = useState("");
  const [useHours, setUseHours] = useState(!!(initial?.hours_from && initial?.hours_to));
  const [from, setFrom] = useState(initial?.hours_from ?? "18:00");
  const [to, setTo] = useState(initial?.hours_to ?? "08:00");
  const [useDays, setUseDays] = useState(!!initial?.weekdays);
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ? initial.weekdays.split(",").map(Number) : [1, 2, 3, 4, 5]);
  const [matchKind, setMatchKind] = useState<MatchKind>(initial?.match_kind ?? "any");
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [replyKind, setReplyKind] = useState<ReplyKind>(initial?.reply_kind ?? "text");
  const [text, setText] = useState(initial?.text ?? "");
  const [instructions, setInstructions] = useState(initial?.ai_instructions ?? "");
  const [aiContext, setAiContext] = useState(initial?.ai_context ?? 10);
  const [cooldown, setCooldown] = useState(initial?.cooldown_min ?? 60);
  const [quote, setQuote] = useState(initial ? !!initial.quote : true);
  const [markSeen, setMarkSeen] = useState(!!initial?.mark_seen);
  const [test, setTest] = useState("");
  const [preview, setPreview] = useState<{ busy: boolean; text?: string; error?: string }>({ busy: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (chats ?? [])
      .filter((c) => c.id !== "status@broadcast" && !chatIds.includes(c.id))
      .filter((c) => !term || (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term))
      .slice(0, 20);
  }, [chats, q, chatIds]);
  const chatName = (id: string) => chats?.find((c) => c.id === id)?.name || displayId(id);

  const regexError = useMemo(() => { if (matchKind !== "regex" || !pattern.trim()) return null; try { new RegExp(pattern, "i"); return null; } catch (e) { return (e as Error).message; } }, [matchKind, pattern]);
  const valid =
    name.trim() &&
    (scope !== "chats" || chatIds.length > 0) &&
    (matchKind === "any" || (pattern.trim() && !regexError)) &&
    (replyKind === "ai" ? true : text.trim()) &&
    (!useDays || weekdays.length > 0);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await upsertRule({
        id: initial?.id ?? Math.random().toString(36).slice(2, 12),
        profile,
        session: sess,
        name: name.trim(),
        enabled: initial?.enabled ?? 1,
        priority: initial?.priority ?? 0,
        scope,
        chat_ids: scope === "chats" ? JSON.stringify(chatIds) : null,
        hours_from: useHours ? from : null,
        hours_to: useHours ? to : null,
        weekdays: useDays ? [...weekdays].sort().join(",") : null,
        match_kind: matchKind,
        pattern: matchKind === "any" ? null : pattern.trim(),
        reply_kind: replyKind,
        text: replyKind === "text" ? text.trim() : null,
        ai_instructions: replyKind === "ai" ? instructions.trim() || null : null,
        ai_context: Math.max(1, Math.min(50, aiContext || 10)),
        cooldown_min: Math.max(0, cooldown || 0),
        quote: quote ? 1 : 0,
        mark_seen: markSeen ? 1 : 0,
        created_at: initial?.created_at,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const seg = (active: boolean): "primary" | "secondary" => (active ? "primary" : "secondary");

  const runPreview = async () => {
    setPreview({ busy: true });
    try {
      const text = await aiAutoReply({ instructions, session: sess, chatName: "Customer", isGroup: false, messages: [sampleMessage(test.trim())] });
      setPreview({ busy: false, text });
    } catch (e) {
      setPreview({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[600px] max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Bot size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">{initial ? "Edit rule" : "New auto-reply rule"}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Out of office · Store FAQ · After hours" autoFocus />
            </div>
            <div>
              <Label>Session (business / number)</Label>
              <SessionSelect value={sess} onChange={(v) => { setSess(v); setChatIds([]); }} className="min-w-[180px]" />
            </div>
          </div>

          <div>
            <Label>Reply to</Label>
            <div className="flex flex-wrap gap-1">
              {(["dm", "groups", "all", "chats"] as Scope[]).map((s) => <Button key={s} size="sm" variant={seg(scope === s)} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</Button>)}
            </div>
            {scope === "chats" && (
              <div className="mt-2 rounded-lg border border-neutral-200 dark:border-neutral-700">
                {chatIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 p-2 border-b border-neutral-200 dark:border-neutral-700">
                    {chatIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 pl-1 pr-2 py-0.5 text-xs">
                        <Avatar name={chatName(id)} size={18} />{chatName(id)}
                        <button onClick={() => setChatIds((x) => x.filter((c) => c !== id))}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts or groups to add…" className="w-full bg-transparent px-3 py-2 text-sm outline-none" />
                <ul className="max-h-40 overflow-y-auto border-t border-neutral-200 dark:border-neutral-700">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => { setChatIds((x) => [...x, c.id]); setQ(""); }}>
                        <Avatar name={c.name || displayId(c.id)} size={24} />
                        <span className="flex-1 truncate text-sm">{c.name || displayId(c.id)}</span>
                        {isGroup(c.id) ? <Badge tone="neutral"><Users size={10} /> group</Badge> : <Badge tone="neutral"><User size={10} /> contact</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Hours</Label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useHours} onChange={(e) => setUseHours(e.target.checked)} /> Only between</label>
              <div className={cn("flex items-center gap-2 mt-1", !useHours && "opacity-40 pointer-events-none")}>
                <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm" />
                <span className="text-xs text-neutral-500">to</span>
                <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm" />
              </div>
              {useHours && from > to && <div className="text-[11px] text-neutral-500 mt-1">Wraps past midnight.</div>}
            </div>
            <div>
              <Label>Days</Label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useDays} onChange={(e) => setUseDays(e.target.checked)} /> Only on</label>
              <div className={cn("flex gap-1 mt-1", !useDays && "opacity-40 pointer-events-none")}>
                {DAYS.map((d, i) => (
                  <button key={d} onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} className={cn("w-8 h-7 rounded-md text-[11px] font-medium", weekdays.includes(i) ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800")}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label>When the message</Label>
            <div className="flex gap-1 mb-2">
              <Button size="sm" variant={seg(matchKind === "any")} onClick={() => setMatchKind("any")}>Is anything</Button>
              <Button size="sm" variant={seg(matchKind === "keywords")} onClick={() => setMatchKind("keywords")}>Contains keywords</Button>
              <Button size="sm" variant={seg(matchKind === "regex")} onClick={() => setMatchKind("regex")}>Matches regex</Button>
            </div>
            {matchKind !== "any" && (
              <>
                <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={matchKind === "keywords" ? "harga, price, berapa, order" : "^(hi|halo)\\b"} className="font-mono" />
                {regexError && <div className="text-[11px] text-red-600 mt-1">{regexError}</div>}
                <div className="flex items-center gap-2 mt-1.5">
                  <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="Try a message…" className="flex-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs outline-none" />
                  {test && <Badge tone={textMatches({ match_kind: matchKind, pattern }, test) ? "green" : "red"}>{textMatches({ match_kind: matchKind, pattern }, test) ? "matches" : "no match"}</Badge>}
                </div>
              </>
            )}
          </div>

          <div>
            <Label>Reply with</Label>
            <div className="flex gap-1 mb-2">
              <Button size="sm" variant={seg(replyKind === "text")} onClick={() => setReplyKind("text")}><MessageSquareText size={12} /> Fixed text</Button>
              <Button size="sm" variant={seg(replyKind === "ai")} onClick={() => setReplyKind("ai")}><Sparkles size={12} /> AI reply</Button>
            </div>
            {replyKind === "text" ? (
              <>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Hi {name}, thanks for your message! We're closed right now and will reply from 08:00." className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-wa-dark" />
                <div className="text-[11px] text-neutral-500">Variables: {"{name} {phone} {time} {date}"} · WhatsApp formatting works (*bold*, _italic_).</div>
              </>
            ) : (
              <>
                {!aiConfigured() && <div className="text-xs text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1"><AlertTriangle size={12} /> AI is not configured (Settings → AI). The rule will log errors until it is.</div>}
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={6} placeholder={"What the AI may say and how. E.g.\n- We sell handmade bags; open Mon–Sat 09:00–17:00\n- Prices: tote 150k, backpack 250k; shipping via JNE\n- Friendly, short, Bahasa Indonesia; if asked for custom orders say Adam will follow up"} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-wa-dark" />
                <div className="text-[11px] text-neutral-500 flex items-center gap-2">Your persona from Settings → AI is included. Context: last
                  <input type="number" min={1} max={50} value={aiContext} onChange={(e) => setAiContext(Number(e.target.value))} className="w-14 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-xs" /> messages.</div>
                <div className="mt-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="Try it: type what a customer might send…" className="flex-1 rounded-lg bg-white dark:bg-neutral-900 px-2.5 py-1 text-xs outline-none border border-neutral-200 dark:border-neutral-700" onKeyDown={(e) => e.key === "Enter" && test.trim() && runPreview()} />
                    <Button size="sm" variant="secondary" disabled={!test.trim() || preview.busy || !aiConfigured()} onClick={runPreview}>{preview.busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Preview</Button>
                  </div>
                  {preview.text && <div className="text-xs whitespace-pre-wrap selectable">» {preview.text}</div>}
                  {preview.error && <div className="text-xs text-red-600">{preview.error}</div>}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <Label>Cooldown per chat (min)</Label>
              <Input type="number" min={0} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} />
              <div className="text-[11px] text-neutral-500 mt-1">0 = answer every message</div>
            </div>
            <label className="flex items-center gap-2 text-sm pb-5"><input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} /> Quote the message</label>
            <label className="flex items-center gap-2 text-sm pb-5"><input type="checkbox" checked={markSeen} onChange={(e) => setMarkSeen(e.target.checked)} /> Mark as read</label>
          </div>

          {err && <div className="text-sm text-red-600 selectable">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : initial ? "Save" : "Create rule"}</Button>
        </div>
      </div>
    </div>
  );
}

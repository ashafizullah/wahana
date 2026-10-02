import { db } from "@/store/scheduler";
import { isChannel, isGroup } from "@/lib/utils";

export type Scope = "dm" | "groups" | "all" | "chats";
export type MatchKind = "any" | "keywords" | "regex";
export type ReplyKind = "text" | "ai";

export interface AutoReplyRule {
  id: string;
  /** `waha:<profileId>:<session>` or `native:<accountId>`. */
  account: string;
  profile: string;
  session: string;
  name: string;
  enabled: number;
  priority: number;
  scope: Scope;
  chat_ids: string | null; // JSON array
  hours_from: string | null;
  hours_to: string | null;
  weekdays: string | null;
  match_kind: MatchKind;
  pattern: string | null;
  reply_kind: ReplyKind;
  text: string | null;
  ai_instructions: string | null;
  ai_context: number;
  cooldown_min: number;
  quote: number;
  mark_seen: number;
  created_at: number;
  replies: number;
  last_run: number | null;
}

export interface AutoReplyLog {
  id: number;
  rule_id: string;
  /** `waha:<profileId>:<session>` or `native:<accountId>`. */
  account: string;
  session: string;
  chat_id: string;
  chat_name: string | null;
  incoming: string | null;
  reply: string | null;
  status: "sent" | "error";
  error: string | null;
  at: number;
}

/** All rules, or — with an account — only that account's. */
export const listRules = async (account?: string) =>
  account === undefined
    ? (await db()).select<AutoReplyRule[]>("SELECT * FROM auto_reply_rules ORDER BY priority ASC, created_at ASC")
    : (await db()).select<AutoReplyRule[]>("SELECT * FROM auto_reply_rules WHERE account = $1 ORDER BY priority ASC, created_at ASC", [
        account,
      ]);

export const activeRules = async (account: string) =>
  (await db()).select<AutoReplyRule[]>(
    "SELECT * FROM auto_reply_rules WHERE account = $1 AND enabled = 1 ORDER BY priority ASC, created_at ASC",
    [account],
  );

export async function upsertRule(r: Omit<AutoReplyRule, "created_at" | "replies" | "last_run"> & { created_at?: number }) {
  await (
    await db()
  ).execute(
    `INSERT INTO auto_reply_rules (id, account, profile, session, name, enabled, priority, scope, chat_ids, hours_from, hours_to, weekdays, match_kind, pattern, reply_kind, text, ai_instructions, ai_context, cooldown_min, quote, mark_seen, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT(id) DO UPDATE SET account=excluded.account, session=excluded.session, name=excluded.name, enabled=excluded.enabled, priority=excluded.priority, scope=excluded.scope,
       chat_ids=excluded.chat_ids, hours_from=excluded.hours_from, hours_to=excluded.hours_to, weekdays=excluded.weekdays, match_kind=excluded.match_kind,
       pattern=excluded.pattern, reply_kind=excluded.reply_kind, text=excluded.text, ai_instructions=excluded.ai_instructions, ai_context=excluded.ai_context,
       cooldown_min=excluded.cooldown_min, quote=excluded.quote, mark_seen=excluded.mark_seen`,
    [
      r.id,
      r.account,
      r.profile,
      r.session,
      r.name,
      r.enabled,
      r.priority,
      r.scope,
      r.chat_ids,
      r.hours_from,
      r.hours_to,
      r.weekdays,
      r.match_kind,
      r.pattern,
      r.reply_kind,
      r.text,
      r.ai_instructions,
      r.ai_context,
      r.cooldown_min,
      r.quote,
      r.mark_seen,
      r.created_at ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export const setRuleEnabled = async (id: string, enabled: boolean) =>
  (await db()).execute("UPDATE auto_reply_rules SET enabled = $2 WHERE id = $1", [id, enabled ? 1 : 0]);

export async function deleteRule(id: string) {
  const d = await db();
  await d.execute("DELETE FROM auto_reply_log WHERE rule_id = $1", [id]);
  await d.execute("DELETE FROM auto_reply_rules WHERE id = $1", [id]);
}

/** All log rows, or — with an account — only that account's. */
export const listLog = async (account?: string, limit = 200) =>
  account === undefined
    ? (await db()).select<AutoReplyLog[]>("SELECT * FROM auto_reply_log ORDER BY at DESC LIMIT $1", [limit])
    : (await db()).select<AutoReplyLog[]>("SELECT * FROM auto_reply_log WHERE account = $1 ORDER BY at DESC LIMIT $2", [account, limit]);

/** Clears one account's log, or every account's when called with no argument. */
export const clearLog = async (account?: string) =>
  account === undefined
    ? (await db()).execute("DELETE FROM auto_reply_log", [])
    : (await db()).execute("DELETE FROM auto_reply_log WHERE account = $1", [account]);

/** Unix time of the last successful reply by this rule in this chat (for cooldowns). */
export async function lastReplyAt(ruleId: string, chatId: string): Promise<number | null> {
  const rows = await (
    await db()
  ).select<{ at: number }[]>(
    "SELECT at FROM auto_reply_log WHERE rule_id = $1 AND chat_id = $2 AND status = 'sent' ORDER BY at DESC LIMIT 1",
    [ruleId, chatId],
  );
  return rows[0]?.at ?? null;
}

/** Replies sent by any rule to this chat since `since` (unix) — the loop guard. */
export async function repliesSince(account: string, chatId: string, since: number): Promise<number> {
  const rows = await (
    await db()
  ).select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM auto_reply_log WHERE account = $1 AND chat_id = $2 AND status = 'sent' AND at >= $3",
    [account, chatId, since],
  );
  return rows[0]?.n ?? 0;
}

/** Replies sent today (local midnight →) by any rule of `account` — the daily spend guard. */
export async function repliesToday(account: string): Promise<number> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const rows = await (
    await db()
  ).select<{ n: number }[]>("SELECT COUNT(*) AS n FROM auto_reply_log WHERE account = $1 AND status = 'sent' AND at >= $2", [
    account,
    Math.floor(midnight.getTime() / 1000),
  ]);
  return rows[0]?.n ?? 0;
}

export async function logReply(entry: Omit<AutoReplyLog, "id" | "at">) {
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  await d.execute(
    "INSERT INTO auto_reply_log (rule_id, account, session, chat_id, chat_name, incoming, reply, status, error, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      entry.rule_id,
      entry.account,
      entry.session,
      entry.chat_id,
      entry.chat_name,
      entry.incoming,
      entry.reply,
      entry.status,
      entry.error,
      now,
    ],
  );
  if (entry.status === "sent")
    await d.execute("UPDATE auto_reply_rules SET replies = replies + 1, last_run = $2 WHERE id = $1", [entry.rule_id, now]);
}

// ── Matching (pure, so the UI can preview it) ──────────────────────────────

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is `now` inside the rule's active window (hours may wrap past midnight, weekdays are local)? */
export function inWindow(r: Pick<AutoReplyRule, "hours_from" | "hours_to" | "weekdays">, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = r.hours_from ? toMin(r.hours_from) : null;
  const to = r.hours_to ? toMin(r.hours_to) : null;
  const wraps = from !== null && to !== null && from > to;
  // A window that wraps past midnight (18:00–08:00) belongs to the day it started on:
  // Saturday 01:00 is still "Friday night" for the weekday filter.
  const day = wraps && cur < to! ? (now.getDay() + 6) % 7 : now.getDay();
  const days = r.weekdays
    ? r.weekdays
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map(Number)
    : [];
  if (days.length && !days.includes(day)) return false;
  if (from === null || to === null || from === to) return true;
  return wraps ? cur >= from || cur < to : cur >= from && cur < to;
}

export function scopeMatches(r: Pick<AutoReplyRule, "scope" | "chat_ids">, chatId: string) {
  if (isChannel(chatId) || chatId === "status@broadcast") return false;
  switch (r.scope) {
    case "all":
      return true;
    case "dm":
      return !isGroup(chatId);
    case "groups":
      return isGroup(chatId);
    case "chats": {
      try {
        return (JSON.parse(r.chat_ids ?? "[]") as string[]).includes(chatId);
      } catch {
        return false;
      }
    }
  }
}

export function textMatches(r: Pick<AutoReplyRule, "match_kind" | "pattern">, body: string) {
  const p = (r.pattern ?? "").trim();
  if (r.match_kind === "any" || !p) return true;
  const text = body.toLowerCase();
  if (r.match_kind === "keywords")
    return p
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .some((k) => text.includes(k));
  try {
    return new RegExp(p, "i").test(body);
  } catch {
    return false;
  }
}

export function ruleMatches(r: AutoReplyRule, chatId: string, body: string, now = new Date()) {
  return scopeMatches(r, chatId) && inWindow(r, now) && textMatches(r, body);
}

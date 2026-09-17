import Database from "@tauri-apps/plugin-sql";

export type Repeat = "once" | "daily" | "weekly" | "monthly";
export type TargetType = "chat" | "status";
export type Kind = "text" | "image" | "video" | "file";

export interface Schedule {
  id: string;
  profile: string;
  session: string;
  target_type: TargetType;
  target_id: string | null;
  target_name: string | null;
  kind: Kind;
  text: string | null;
  media_b64: string | null;
  media_mime: string | null;
  media_name: string | null;
  next_run: number;
  /** The first-run time the user picked; repeats derive time-of-day and day-of-month from it. */
  anchor: number | null;
  repeat: Repeat;
  weekdays: string | null;
  enabled: number;
  created_at: number;
  last_run: number | null;
  last_status: "ok" | "error" | "missed" | null;
  last_error: string | null;
  runs: number;
}

export interface Run {
  id: number;
  schedule_id: string;
  ran_at: number;
  status: "ok" | "error" | "missed";
  error: string | null;
  message_id: string | null;
}

let dbPromise: Promise<Database> | null = null;
export const db = () => (dbPromise ??= Database.load("sqlite:wahana.db"));

const COLS =
  "id, profile, session, target_type, target_id, target_name, kind, text, media_mime, media_name, next_run, anchor, repeat, weekdays, enabled, created_at, last_run, last_status, last_error, runs";

export async function listSchedules(profile: string): Promise<Schedule[]> {
  const d = await db();
  return d.select<Schedule[]>(`SELECT ${COLS}, NULL AS media_b64 FROM schedules WHERE profile = $1 ORDER BY enabled DESC, next_run ASC`, [
    profile,
  ]);
}

export async function getSchedule(id: string): Promise<Schedule | undefined> {
  const d = await db();
  return (await d.select<Schedule[]>("SELECT * FROM schedules WHERE id = $1", [id]))[0];
}

export async function dueSchedules(now: number): Promise<Schedule[]> {
  const d = await db();
  return d.select<Schedule[]>("SELECT * FROM schedules WHERE enabled = 1 AND next_run <= $1 ORDER BY next_run ASC", [now]);
}

export async function upsertSchedule(
  s: Omit<Schedule, "created_at" | "last_run" | "last_status" | "last_error" | "runs" | "anchor"> & {
    created_at?: number;
    anchor?: number | null;
  },
) {
  const d = await db();
  await d.execute(
    `INSERT INTO schedules (id, profile, session, target_type, target_id, target_name, kind, text, media_b64, media_mime, media_name, next_run, anchor, repeat, weekdays, enabled, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT(id) DO UPDATE SET session=excluded.session, target_type=excluded.target_type, target_id=excluded.target_id, target_name=excluded.target_name,
       kind=excluded.kind, text=excluded.text, media_b64=COALESCE(excluded.media_b64, schedules.media_b64), media_mime=COALESCE(excluded.media_mime, schedules.media_mime),
       media_name=COALESCE(excluded.media_name, schedules.media_name), next_run=excluded.next_run, anchor=excluded.anchor, repeat=excluded.repeat, weekdays=excluded.weekdays, enabled=excluded.enabled`,
    [
      s.id,
      s.profile,
      s.session,
      s.target_type,
      s.target_id,
      s.target_name,
      s.kind,
      s.text,
      s.media_b64,
      s.media_mime,
      s.media_name,
      s.next_run,
      s.anchor ?? s.next_run,
      s.repeat,
      s.weekdays,
      s.enabled,
      s.created_at ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function setEnabled(id: string, enabled: boolean) {
  const d = await db();
  await d.execute("UPDATE schedules SET enabled = $1 WHERE id = $2", [enabled ? 1 : 0, id]);
}

export async function deleteSchedule(id: string) {
  const d = await db();
  await d.execute("DELETE FROM schedule_runs WHERE schedule_id = $1", [id]);
  await d.execute("DELETE FROM schedules WHERE id = $1", [id]);
}

/**
 * Claim a due schedule *before* sending: advance `next_run` (or disable a one-shot) only if
 * the row is still at the value we read. A second app instance, or a restart after a crash
 * between send and bookkeeping, then finds nothing to send. Returns false when someone
 * else already claimed it.
 */
export async function claimRun(s: Schedule, nextRun: number | null): Promise<boolean> {
  const d = await db();
  const r = await d.execute(
    "UPDATE schedules SET next_run = COALESCE($1, next_run), enabled = CASE WHEN $1 IS NULL THEN 0 ELSE enabled END WHERE id = $2 AND next_run = $3 AND enabled = 1",
    [nextRun, s.id, s.next_run],
  );
  return r.rowsAffected === 1;
}

export async function recordRun(s: Schedule, status: Run["status"], opts: { error?: string; messageId?: string }) {
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  await d.execute("INSERT INTO schedule_runs (schedule_id, ran_at, status, error, message_id) VALUES ($1,$2,$3,$4,$5)", [
    s.id,
    now,
    status,
    opts.error ?? null,
    opts.messageId ?? null,
  ]);
  await d.execute("UPDATE schedules SET last_run = $1, last_status = $2, last_error = $3, runs = runs + 1 WHERE id = $4", [
    now,
    status,
    opts.error ?? null,
    s.id,
  ]);
}

/** Days of run history / auto-reply log / finished broadcasts kept before pruning. */
export const LOG_RETENTION_DAYS = 90;

/** Delete old log rows so the SQLite file does not grow forever (called once at startup). */
export async function pruneLogs(days = LOG_RETENTION_DAYS) {
  const d = await db();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  await d.execute("DELETE FROM schedule_runs WHERE ran_at < $1", [cutoff]);
  await d.execute("DELETE FROM auto_reply_log WHERE at < $1", [cutoff]);
  // Finished / cancelled broadcasts keep their per-recipient log until they age out.
  await d.execute(
    "DELETE FROM broadcast_items WHERE broadcast_id IN (SELECT id FROM broadcasts WHERE status IN ('done','cancelled') AND COALESCE(finished_at, created_at) < $1)",
    [cutoff],
  );
  await d.execute("DELETE FROM broadcasts WHERE status IN ('done','cancelled') AND COALESCE(finished_at, created_at) < $1", [cutoff]);
}

export async function listRuns(scheduleId: string, limit = 50): Promise<Run[]> {
  const d = await db();
  return d.select<Run[]>("SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY ran_at DESC LIMIT $2", [scheduleId, limit]);
}

/** Next occurrence strictly after `after` for a repeating schedule; null for one-shots. */
export function nextOccurrence(
  s: Pick<Schedule, "next_run" | "repeat" | "weekdays"> & { anchor?: number | null },
  after: number,
): number | null {
  if (s.repeat === "once") return null;
  // Time-of-day and day-of-month come from the originally chosen time, not from the
  // (possibly clamped) current next_run.
  const base = new Date((s.anchor ?? s.next_run) * 1000);
  const hh = base.getHours(),
    mm = base.getMinutes();
  const cursor = new Date(after * 1000);
  cursor.setSeconds(0, 0);
  const candidate = new Date(cursor);
  candidate.setHours(hh, mm, 0, 0);
  if (s.repeat === "daily") {
    if (candidate.getTime() / 1000 <= after) candidate.setDate(candidate.getDate() + 1);
    return Math.floor(candidate.getTime() / 1000);
  }
  if (s.repeat === "weekly") {
    // Note: Number("") is 0, so drop empty entries before parsing or "" would mean Sunday.
    const parsed = (s.weekdays ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    const days = parsed.length ? parsed : [base.getDay()]; // empty/garbage → keep the original weekday rather than disabling the schedule
    for (let i = 0; i < 8; i++) {
      const c = new Date(candidate);
      c.setDate(candidate.getDate() + i);
      if (days.includes(c.getDay()) && c.getTime() / 1000 > after) return Math.floor(c.getTime() / 1000);
    }
    return null;
  }
  // monthly: same day-of-month as the original; clamp to month length
  const dom = base.getDate();
  for (let i = 0; i < 13; i++) {
    const c = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1, hh, mm, 0, 0);
    const last = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
    c.setDate(Math.min(dom, last));
    if (c.getTime() / 1000 > after) return Math.floor(c.getTime() / 1000);
  }
  return null;
}

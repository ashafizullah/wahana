import { db } from "@/store/scheduler";

export interface QuickReply {
  id: string;
  profile: string;
  /** Limit to one session (business / number); null = available everywhere. */
  session: string | null;
  shortcut: string;
  text: string;
  created_at: number;
}

/** All quick replies of a server (Settings), or — with `session` — only those usable in that session. */
export const listQuickReplies = async (profile: string, session?: string) =>
  session === undefined
    ? (await db()).select<QuickReply[]>("SELECT * FROM quick_replies WHERE profile = $1 ORDER BY shortcut", [profile])
    : (await db()).select<QuickReply[]>("SELECT * FROM quick_replies WHERE profile = $1 AND (session IS NULL OR session = $2) ORDER BY shortcut", [profile, session]);

export async function saveQuickReply(r: Omit<QuickReply, "created_at">) {
  await (await db()).execute(
    "INSERT INTO quick_replies (id, profile, session, shortcut, text, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET session=excluded.session, shortcut=excluded.shortcut, text=excluded.text",
    [r.id, r.profile, r.session || null, r.shortcut.replace(/^\//, "").trim().toLowerCase(), r.text, Math.floor(Date.now() / 1000)],
  );
}

export const deleteQuickReply = async (id: string) => (await db()).execute("DELETE FROM quick_replies WHERE id = $1", [id]);

/** Expand template variables against the current chat. */
export function expandTemplate(text: string, ctx: { name?: string; phone?: string }) {
  const now = new Date();
  return text
    .replace(/\{name\}/gi, ctx.name ?? "")
    .replace(/\{phone\}/gi, ctx.phone ?? "")
    .replace(/\{time\}/gi, now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    .replace(/\{date\}/gi, now.toLocaleDateString());
}

import { accountMatches } from "@/lib/account";
import { db } from "@/store/scheduler";

export interface QuickReply {
  id: string;
  /** Account this reply is limited to (`native:<id>`), or null for every account. */
  account: string | null;
  shortcut: string;
  text: string;
  created_at: number;
}

/** All quick replies (Settings), or — with an account — only those usable there. */
export const listQuickReplies = async (account?: string) => {
  const rows = await (await db()).select<QuickReply[]>("SELECT * FROM quick_replies ORDER BY shortcut");
  return account === undefined ? rows : rows.filter((r) => accountMatches(r.account, account));
};

export async function saveQuickReply(r: Omit<QuickReply, "created_at">) {
  await (
    await db()
  ).execute(
    "INSERT INTO quick_replies (id, account, shortcut, text, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET account=excluded.account, shortcut=excluded.shortcut, text=excluded.text",
    [r.id, r.account || null, r.shortcut.replace(/^\//, "").trim().toLowerCase(), r.text, Math.floor(Date.now() / 1000)],
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

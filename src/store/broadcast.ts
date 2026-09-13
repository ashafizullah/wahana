import { db } from "@/store/scheduler";
import type { Kind } from "@/store/scheduler";

export interface Broadcast {
  id: string;
  profile: string;
  session: string;
  name: string | null;
  kind: Kind;
  text: string | null;
  media_b64: string | null;
  media_mime: string | null;
  media_name: string | null;
  delay_min: number;
  delay_max: number;
  status: "draft" | "running" | "paused" | "done" | "cancelled";
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}
export interface BroadcastItem {
  id: number;
  broadcast_id: string;
  chat_id: string;
  name: string | null;
  status: "pending" | "sent" | "error" | "skipped";
  error: string | null;
  message_id: string | null;
  sent_at: number | null;
}
export interface BroadcastSummary extends Broadcast {
  total: number;
  sent: number;
  failed: number;
}

const COLS = "b.id, b.profile, b.session, b.name, b.kind, b.text, b.media_mime, b.media_name, b.delay_min, b.delay_max, b.status, b.created_at, b.started_at, b.finished_at";

export const listBroadcasts = async (profile: string) =>
  (await db()).select<BroadcastSummary[]>(
    `SELECT ${COLS}, NULL AS media_b64,
       (SELECT COUNT(*) FROM broadcast_items i WHERE i.broadcast_id = b.id) AS total,
       (SELECT COUNT(*) FROM broadcast_items i WHERE i.broadcast_id = b.id AND i.status = 'sent') AS sent,
       (SELECT COUNT(*) FROM broadcast_items i WHERE i.broadcast_id = b.id AND i.status = 'error') AS failed
     FROM broadcasts b WHERE b.profile = $1 ORDER BY b.created_at DESC`,
    [profile],
  );

export const getBroadcast = async (id: string) => (await (await db()).select<Broadcast[]>("SELECT * FROM broadcasts WHERE id = $1", [id]))[0];
export const listItems = async (id: string) => (await db()).select<BroadcastItem[]>("SELECT * FROM broadcast_items WHERE broadcast_id = $1 ORDER BY id", [id]);
export const nextPending = async (id: string) => (await (await db()).select<BroadcastItem[]>("SELECT * FROM broadcast_items WHERE broadcast_id = $1 AND status = 'pending' ORDER BY id LIMIT 1", [id]))[0];

export async function createBroadcast(b: Omit<Broadcast, "created_at" | "started_at" | "finished_at" | "status">, recipients: { chatId: string; name?: string | null }[]) {
  const d = await db();
  await d.execute(
    "INSERT INTO broadcasts (id, profile, session, name, kind, text, media_b64, media_mime, media_name, delay_min, delay_max, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12)",
    [b.id, b.profile, b.session, b.name, b.kind, b.text, b.media_b64, b.media_mime, b.media_name, b.delay_min, b.delay_max, Math.floor(Date.now() / 1000)],
  );
  for (const r of recipients) await d.execute("INSERT INTO broadcast_items (broadcast_id, chat_id, name) VALUES ($1,$2,$3)", [b.id, r.chatId, r.name ?? null]);
}

export const setBroadcastStatus = async (id: string, status: Broadcast["status"]) => {
  const now = Math.floor(Date.now() / 1000);
  await (await db()).execute(
    "UPDATE broadcasts SET status = $1, started_at = CASE WHEN $1 = 'running' AND started_at IS NULL THEN $2 ELSE started_at END, finished_at = CASE WHEN $1 IN ('done','cancelled') THEN $2 ELSE finished_at END WHERE id = $3",
    [status, now, id],
  );
};

export const markItem = async (itemId: number, status: BroadcastItem["status"], error?: string, messageId?: string) =>
  (await db()).execute("UPDATE broadcast_items SET status = $1, error = $2, message_id = $3, sent_at = $4 WHERE id = $5", [status, error ?? null, messageId ?? null, Math.floor(Date.now() / 1000), itemId]);

export const deleteBroadcast = async (id: string) => {
  const d = await db();
  await d.execute("DELETE FROM broadcast_items WHERE broadcast_id = $1", [id]);
  await d.execute("DELETE FROM broadcasts WHERE id = $1", [id]);
};

/** Reset failed items to pending so a re-run only retries them. */
export const retryFailed = async (id: string) => (await db()).execute("UPDATE broadcast_items SET status = 'pending', error = NULL WHERE broadcast_id = $1 AND status = 'error'", [id]);

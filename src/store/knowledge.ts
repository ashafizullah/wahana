import { db } from "@/store/scheduler";

export type KbDocType = "table" | "text";
export type KbStatus = "new" | "indexed" | "error";

/** One knowledge entry: a table (custom columns) or a free-text document. */
export interface KbDoc {
  id: string;
  /** `native:<accountId>`, or null for every account. */
  account: string | null;
  type: KbDocType;
  title: string;
  /** JSON `string[]` — column names (type='table'). */
  columns: string | null;
  /** JSON `string[][]` — row cells (type='table'). */
  rows: string | null;
  /** Document body (type='text'). */
  text: string | null;
  /** Embedding model that produced the current vectors. */
  embed_model: string | null;
  status: KbStatus;
  error: string | null;
  chunk_count: number;
  created_at: number;
  updated_at: number;
}

export interface KbChunk {
  id: number;
  doc_id: string;
  account: string | null;
  ord: number;
  text: string;
  /** base64 of a normalized Float32Array. */
  embedding: string;
  dim: number;
  model: string;
}

export interface NewChunk {
  ord: number;
  text: string;
  embedding: string;
  dim: number;
}

/** All docs, or — with an account — only that account's (global docs are not included). */
export const listDocs = async (account?: string) =>
  account === undefined
    ? (await db()).select<KbDoc[]>("SELECT * FROM kb_docs ORDER BY updated_at DESC")
    : (await db()).select<KbDoc[]>("SELECT * FROM kb_docs WHERE account = $1 ORDER BY updated_at DESC", [account]);

/** Docs that apply to an account: the global ones plus that account's own. */
export const listDocsFor = async (account: string) =>
  (await db()).select<KbDoc[]>("SELECT * FROM kb_docs WHERE account IS NULL OR account = $1 ORDER BY updated_at DESC", [account]);

export const getDoc = async (id: string) => (await db()).select<KbDoc[]>("SELECT * FROM kb_docs WHERE id = $1", [id]).then((r) => r[0]);

export async function saveDoc(
  d: Omit<KbDoc, "created_at" | "updated_at" | "embed_model" | "status" | "error" | "chunk_count"> & {
    created_at?: number;
  },
) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await getDoc(d.id);
  const conn = await db();
  await conn.execute(
    `INSERT INTO kb_docs (id, account, type, title, columns, rows, text, embed_model, status, error, chunk_count, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'new',NULL,0,$8,$9)
     ON CONFLICT(id) DO UPDATE SET account=excluded.account, type=excluded.type, title=excluded.title, columns=excluded.columns,
       rows=excluded.rows, text=excluded.text, embed_model=NULL, status='new', error=NULL, chunk_count=0, updated_at=excluded.updated_at`,
    [d.id, d.account, d.type, d.title, d.columns, d.rows, d.text, existing?.created_at ?? d.created_at ?? now, now],
  );
  // The content may have changed: drop the old vectors now, so a later failed re-index
  // leaves the entry unusable (visible error) instead of silently answering from stale text.
  await conn.execute("DELETE FROM kb_chunks WHERE doc_id = $1", [d.id]);
}

/** Rows per multi-row INSERT (7 params each, well under SQLite's bound-parameter limit). */
const INSERT_BATCH = 100;

/** Replace a doc's vectors. The embedding model is stamped on the doc so stale vectors can be spotted. */
export async function replaceChunks(docId: string, account: string | null, model: string, chunks: NewChunk[]) {
  const d = await db();
  // The plugin's connection pool cannot hold a transaction across calls, so the doc is marked 'new'
  // first: candidateChunks skips it until the final UPDATE, and a crash or failure midway leaves
  // a visibly un-indexed entry instead of a partial set of vectors that is silently used.
  await d.execute("UPDATE kb_docs SET status = 'new', embed_model = NULL WHERE id = $1", [docId]);
  try {
    await d.execute("DELETE FROM kb_chunks WHERE doc_id = $1", [docId]);
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const batch = chunks.slice(i, i + INSERT_BATCH);
      const params: unknown[] = [];
      const values = batch.map((c) => {
        const b = params.length;
        params.push(docId, account, c.ord, c.text, c.embedding, c.dim, model);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      });
      await d.execute(`INSERT INTO kb_chunks (doc_id, account, ord, text, embedding, dim, model) VALUES ${values.join(",")}`, params);
    }
  } catch (e) {
    await d.execute("DELETE FROM kb_chunks WHERE doc_id = $1", [docId]).catch(() => {});
    throw e;
  }
  await d.execute(
    "UPDATE kb_docs SET embed_model = $2, status = 'indexed', error = NULL, chunk_count = $3, updated_at = $4 WHERE id = $1",
    [docId, model, chunks.length, Math.floor(Date.now() / 1000)],
  );
}

export async function markDocError(docId: string, message: string) {
  await (
    await db()
  ).execute("UPDATE kb_docs SET status = 'error', error = $2, updated_at = $3 WHERE id = $1", [
    docId,
    message,
    Math.floor(Date.now() / 1000),
  ]);
}

export async function deleteDoc(id: string) {
  const d = await db();
  await d.execute("DELETE FROM kb_chunks WHERE doc_id = $1", [id]);
  await d.execute("DELETE FROM kb_docs WHERE id = $1", [id]);
}

/**
 * Skips docs whose vectors are being rewritten (status 'new', see replaceChunks). 'error' docs keep
 * their last good vectors: a failed re-index of unchanged content must not switch the entry off.
 */
const READY = "AND doc_id IN (SELECT id FROM kb_docs WHERE status <> 'new')";

/**
 * Chunks that may answer for `account`: the account's own plus the global ones. A chunk is never
 * returned for an account it does not belong to (model mismatch would also mix vector spaces).
 * `account = null` means "global entries only".
 */
export async function candidateChunks(account: string | null, model: string) {
  const d = await db();
  return account === null
    ? d.select<Pick<KbChunk, "doc_id" | "account" | "ord" | "text" | "embedding" | "dim">[]>(
        `SELECT doc_id, account, ord, text, embedding, dim FROM kb_chunks WHERE model = $1 AND account IS NULL ${READY}`,
        [model],
      )
    : d.select<Pick<KbChunk, "doc_id" | "account" | "ord" | "text" | "embedding" | "dim">[]>(
        `SELECT doc_id, account, ord, text, embedding, dim FROM kb_chunks WHERE model = $1 AND (account IS NULL OR account = $2) ${READY}`,
        [model, account],
      );
}

export const totalChunks = async () =>
  (await (await db()).select<{ n: number }[]>("SELECT COUNT(*) AS n FROM kb_chunks")).map((r) => r.n)[0] ?? 0;

/** Vectors visible to one account (its own plus the global ones). */
export async function chunksFor(account: string): Promise<number> {
  const rows = await (
    await db()
  ).select<{ n: number }[]>("SELECT COUNT(*) AS n FROM kb_chunks WHERE account IS NULL OR account = $1", [account]);
  return rows[0]?.n ?? 0;
}

/**
 * Docs whose vectors are missing, were made with a different model, or have a dimension that does
 * not match the vectors stored for that model (a provider can serve the same model name with a
 * different width). Such vectors can never be compared safely, so those entries need a re-index.
 * With an account, that account's own entries plus the global ones are counted.
 */
export async function staleDocs(model: string, account?: string): Promise<number> {
  const rows = await (
    await db()
  ).select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM kb_docs d
      WHERE (d.account IS NULL OR $2 IS NULL OR d.account = $2)
        AND (
          d.embed_model IS NULL
          OR d.embed_model <> $1
          OR EXISTS (
            SELECT 1 FROM kb_chunks c
             WHERE c.doc_id = d.id
               AND c.dim <> (SELECT c2.dim FROM kb_chunks c2 WHERE c2.model = $1 GROUP BY c2.dim ORDER BY COUNT(*) DESC LIMIT 1)
          )
        )`,
    [model, account ?? null],
  );
  return rows[0]?.n ?? 0;
}

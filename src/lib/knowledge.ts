import { embed, embedConfig, embedConfigured as aiEmbedConfigured, embedOne } from "@/lib/ai";
import { errMsg } from "@/lib/utils";
import {
  candidateChunks,
  chunksFor,
  getDoc,
  listDocs,
  listDocsFor,
  markDocError,
  replaceChunks,
  staleDocs,
  totalChunks,
  type KbDoc,
} from "@/store/knowledge";

/** Hard cap on stored vectors; retrieval is a brute-force scan so it must stay bounded. */
export const KB_MAX_CHUNKS = 5000;
/** Hard cap on a single document's text (characters). */
export const KB_MAX_DOC_CHARS = 400_000;
/** Longest text sent to the embeddings endpoint as one chunk. */
export const KB_MAX_CHUNK_CHARS = 1600;
export const KB_DEFAULT_TOP_K = 5;
export const KB_DEFAULT_MIN_SCORE = 0.3;

export const kbConfigured = () => aiEmbedConfigured();
export const kbModel = () => embedConfig().model;

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ── Chunking ───────────────────────────────────────────────────────────────

/** Split a paragraph that is longer than `max` at whitespace boundaries. */
function splitLong(para: string, max: number): string[] {
  if (para.length <= max) return [para];
  const out: string[] = [];
  let i = 0;
  while (i < para.length) {
    let end = Math.min(para.length, i + max);
    if (end < para.length) {
      const cut = para.lastIndexOf(" ", end);
      if (cut > i + max * 0.5) end = cut;
    }
    out.push(para.slice(i, end).trim());
    i = end;
  }
  return out.filter(Boolean);
}

/**
 * Split free text into overlapping chunks: paragraphs are packed up to `target` chars, with the
 * tail of the previous chunk carried over so a fact split across a boundary stays retrievable.
 */
export function chunkText(text: string, opts: { target?: number; overlap?: number; max?: number } = {}): string[] {
  const target = opts.target ?? 900;
  const overlap = opts.overlap ?? 150;
  const max = opts.max ?? KB_MAX_CHUNK_CHARS;
  const clean = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  const units = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, max));
  const chunks: string[] = [];
  let cur = "";
  for (const u of units) {
    if (!cur) {
      cur = u;
      continue;
    }
    if (cur.length + 2 + u.length <= target) {
      cur += "\n\n" + u;
      continue;
    }
    const prev = cur;
    chunks.push(prev.trim());
    const tail = prev.slice(-overlap).trim();
    cur = tail && tail.length < u.length ? tail + "\n\n" + u : u;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.flatMap((c) => (c.length > max ? splitLong(c, max) : [c]));
}

/** A table row as an embeddable fact: `Kolom: nilai | Kolom: nilai`. */
export function rowText(title: string, columns: string[], row: string[]): string {
  const pairs = columns
    .map((c, i) => ({ c: c.trim() || `Kolom ${i + 1}`, v: (row[i] ?? "").trim() }))
    .filter((p) => p.v)
    .map((p) => `${p.c}: ${p.v}`);
  return [title.trim(), pairs.join(" | ")].filter(Boolean).join("\n");
}

/** The texts to embed for a doc: one per table row, or chunks of free text. */
export function docChunkTexts(doc: Pick<KbDoc, "type" | "title" | "columns" | "rows" | "text">): string[] {
  if (doc.type === "table") {
    const cols = parseJson<string[]>(doc.columns, []);
    const rows = parseJson<string[][]>(doc.rows, []);
    const title = doc.title.trim();
    return rows
      .map((r) => rowText(doc.title, cols, r))
      .filter((t) => t && t !== title)
      .flatMap((t) => {
        // A row with a huge cell would exceed the embedding input limit and fail the whole entry:
        // split it like free text, keeping the title on every piece for context.
        if (t.length <= KB_MAX_CHUNK_CHARS) return [t];
        const body = title && t.startsWith(title + "\n") ? t.slice(title.length + 1) : t;
        return splitLong(body, Math.max(400, KB_MAX_CHUNK_CHARS - title.length - 1)).map((p) => (title ? `${title}\n${p}` : p));
      });
  }
  // Prefix the title so a chunk keeps its context ("Kebijakan pengiriman") once it is cut out of the doc.
  const title = doc.title.trim();
  return chunkText(doc.text ?? "").map((c) => (title ? `${title}\n${c}` : c));
}

// ── Vectors ────────────────────────────────────────────────────────────────

/** base64 of a Float32Array's bytes (compact, portable through JSON/SQLite). */
export function packVec(v: ArrayLike<number>): string {
  const f = v instanceof Float32Array ? v : Float32Array.from(v);
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function unpackVec(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Unit vector (so a later dot product is already a cosine). */
export function normalize(v: ArrayLike<number>): Float32Array {
  const f = Float32Array.from(v);
  let n = 0;
  for (const x of f) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < f.length; i++) f[i] /= n;
  return f;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

export interface RankedChunk {
  docId: string;
  ord: number;
  text: string;
  score: number;
}

/** Score and order candidate chunks against a query vector. Pure, so it is unit-testable. */
export function rankChunks(
  queryVec: ArrayLike<number>,
  candidates: { docId: string; ord: number; text: string; vec: ArrayLike<number> }[],
  opts: { k?: number; minScore?: number } = {},
): RankedChunk[] {
  const k = Math.max(1, opts.k ?? KB_DEFAULT_TOP_K);
  const minScore = opts.minScore ?? KB_DEFAULT_MIN_SCORE;
  return (
    candidates
      // Vectors of a different width can never be compared: a partial dot product would look like a
      // real score. Skip them (the entry shows up as "re-index needed" instead).
      .filter((c) => c.vec.length === queryVec.length)
      .map((c) => ({ docId: c.docId, ord: c.ord, text: c.text, score: cosine(queryVec, c.vec) }))
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  );
}

/** The retrieval query: the last few incoming messages (falls back to any messages). */
export function buildQuery(messages: { fromMe: boolean; body: string }[], maxChars = 500): string {
  const incoming = messages.filter((m) => !m.fromMe && m.body.trim()).slice(-3);
  const used = incoming.length ? incoming : messages.filter((m) => m.body.trim()).slice(-3);
  return used
    .map((m) => m.body.trim())
    .join("\n")
    .slice(0, maxChars);
}

// ── Indexing & retrieval ───────────────────────────────────────────────────

interface LoadedChunk {
  docId: string;
  account: string | null;
  ord: number;
  text: string;
  vec: Float32Array;
}

/**
 * Whether a stored chunk may be used to answer for `account`. Global chunks (account null) apply to
 * every account; an account's chunks apply to that account only. `account = null` (the settings
 * preview with "All accounts" selected) sees global chunks only. This mirrors candidateChunks' SQL
 * filter and is a second guard so a chunk can never leak into another account's reply.
 */
export function chunkVisibleTo(chunkAccount: string | null, account: string | null): boolean {
  return chunkAccount === null || chunkAccount === account;
}

/**
 * Decoded vectors for a (model, account) scope. Retrieval runs on every incoming message, so the
 * base64 decode is cached rather than repeated; entries are re-read after the TTL or on re-index.
 * The account is part of the cache key, so one account's vectors are never served to another.
 */
let vecCache: { key: string; at: number; rows: LoadedChunk[] } | null = null;
const VEC_CACHE_TTL_MS = 30_000;

export function invalidateKbCache() {
  vecCache = null;
}

async function loadedChunks(account: string | null, model: string): Promise<LoadedChunk[]> {
  const key = `${model}|${account ?? ""}`;
  if (vecCache && vecCache.key === key && Date.now() - vecCache.at < VEC_CACHE_TTL_MS) return vecCache.rows;
  const rows = await candidateChunks(account, model);
  const parsed = rows.map((r) => ({
    docId: r.doc_id,
    account: r.account,
    ord: r.ord,
    text: r.text,
    vec: unpackVec(r.embedding),
  }));
  vecCache = { key, at: Date.now(), rows: parsed };
  return parsed;
}

/** Embed a doc's chunks and store them. Marks the doc 'error' (and rethrows) when embedding fails. */
export async function indexDoc(id: string): Promise<number> {
  const doc = await getDoc(id);
  if (!doc) throw new Error("Knowledge entry not found.");
  try {
    if (!kbConfigured()) throw new Error("Embeddings are not configured (Settings → AI).");
    const model = kbModel();
    const texts = docChunkTexts(doc).map((t) => t.slice(0, KB_MAX_DOC_CHARS));
    if (texts.length === 0) {
      await replaceChunks(doc.id, doc.account, model, []);
      return 0;
    }
    const total = await totalChunks();
    const allowed = KB_MAX_CHUNKS - (total - (doc.chunk_count ?? 0));
    if (texts.length > allowed)
      throw new Error(
        `This entry needs ${texts.length} chunks but only ${Math.max(0, allowed)} fit under the ${KB_MAX_CHUNKS}-chunk limit.`,
      );
    const vecs = await embed(texts);
    const chunks = texts.map((t, i) => ({
      ord: i,
      text: t,
      embedding: packVec(normalize(vecs[i]!)),
      dim: vecs[i]!.length,
    }));
    await replaceChunks(doc.id, doc.account, model, chunks);
    return chunks.length;
  } catch (e) {
    await markDocError(doc.id, errMsg(e));
    throw e;
  } finally {
    invalidateKbCache();
  }
}

/** Re-index the entries in scope (or all of them). Returns how many failed. */
export async function reindexAll(account?: string): Promise<{ indexed: number; failed: number }> {
  const docs = account ? await listDocsFor(account) : await listDocs();
  let indexed = 0;
  let failed = 0;
  for (const d of docs) {
    try {
      await indexDoc(d.id);
      indexed++;
    } catch {
      failed++;
    }
  }
  return { indexed, failed };
}

/**
 * The most relevant knowledge chunks for `account` (global entries included). Throws when the
 * embedding call fails — callers that must not break (the auto-reply runner) should catch.
 */
export async function retrieveKnowledge(
  account: string | null,
  query: string,
  opts: { k?: number; minScore?: number } = {},
): Promise<RankedChunk[]> {
  if (!kbConfigured() || !query.trim()) return [];
  const rows = (await loadedChunks(account, kbModel())).filter((c) => chunkVisibleTo(c.account, account));
  if (rows.length === 0) return [];
  const qv = normalize(await embedOne(query));
  return rankChunks(qv, rows, opts);
}

/** Header stats for the knowledge screen (scoped to an account when one is selected). */
export async function kbStats(account?: string): Promise<{ chunks: number; stale: number }> {
  const model = kbModel();
  const [chunks, stale] = await Promise.all([
    account ? chunksFor(account) : totalChunks(),
    model ? staleDocs(model, account) : Promise.resolve(0),
  ]);
  return { chunks, stale };
}

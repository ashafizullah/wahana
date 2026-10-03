CREATE TABLE IF NOT EXISTS kb_docs (
  id           TEXT PRIMARY KEY,
  account      TEXT,                            -- NULL = every account; 'native:<accountId>' = one account
  type         TEXT NOT NULL,                   -- 'table' | 'text'
  title        TEXT NOT NULL,
  columns      TEXT,                            -- JSON string[] (type='table')
  rows         TEXT,                            -- JSON string[][] (type='table')
  text         TEXT,                            -- (type='text')
  embed_model  TEXT,                            -- model that produced the current vectors
  status       TEXT NOT NULL DEFAULT 'new',     -- 'new' | 'indexed' | 'error'
  error        TEXT,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_docs_account ON kb_docs (account);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id    TEXT NOT NULL,
  account   TEXT,                               -- denormalized from the doc, for scoped retrieval
  ord       INTEGER NOT NULL,
  text      TEXT NOT NULL,
  embedding TEXT NOT NULL,                      -- base64 of a normalized Float32Array
  dim       INTEGER NOT NULL,
  model     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks (doc_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_scope ON kb_chunks (model, account);

ALTER TABLE auto_reply_rules ADD COLUMN ai_use_knowledge INTEGER NOT NULL DEFAULT 1;

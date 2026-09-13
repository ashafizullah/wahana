CREATE TABLE IF NOT EXISTS quick_replies (
  id         TEXT PRIMARY KEY,
  profile    TEXT NOT NULL,
  shortcut   TEXT NOT NULL,             -- typed as "/shortcut"
  text       TEXT NOT NULL,             -- may contain {name} {phone} {time} {date}
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quick_replies_profile ON quick_replies (profile, shortcut);

CREATE TABLE IF NOT EXISTS broadcasts (
  id          TEXT PRIMARY KEY,
  profile     TEXT NOT NULL,
  session     TEXT NOT NULL,
  name        TEXT,
  kind        TEXT NOT NULL,            -- 'text' | 'image' | 'video' | 'file'
  text        TEXT,
  media_b64   TEXT,
  media_mime  TEXT,
  media_name  TEXT,
  delay_min   INTEGER NOT NULL DEFAULT 5,   -- seconds
  delay_max   INTEGER NOT NULL DEFAULT 15,
  status      TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'running' | 'paused' | 'done' | 'cancelled'
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS broadcast_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id TEXT NOT NULL,
  chat_id      TEXT NOT NULL,
  name         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'error' | 'skipped'
  error        TEXT,
  message_id   TEXT,
  sent_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_broadcast_items ON broadcast_items (broadcast_id, status);

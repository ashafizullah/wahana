CREATE TABLE IF NOT EXISTS schedules (
  id           TEXT PRIMARY KEY,
  profile      TEXT NOT NULL,
  session      TEXT NOT NULL,
  target_type  TEXT NOT NULL,            -- 'chat' | 'status'
  target_id    TEXT,                     -- chat id (…@c.us / …@g.us / …@newsletter); NULL for status
  target_name  TEXT,
  kind         TEXT NOT NULL,            -- 'text' | 'image' | 'video' | 'file'
  text         TEXT,                     -- message body or caption
  media_b64    TEXT,
  media_mime   TEXT,
  media_name   TEXT,
  next_run     INTEGER NOT NULL,         -- unix seconds
  repeat       TEXT NOT NULL DEFAULT 'once', -- 'once' | 'daily' | 'weekly' | 'monthly'
  weekdays     TEXT,                     -- for weekly: comma list 0-6 (Sun=0)
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_run     INTEGER,
  last_status  TEXT,                     -- 'ok' | 'error' | 'missed'
  last_error   TEXT,
  runs         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules (enabled, next_run);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id  TEXT NOT NULL,
  ran_at       INTEGER NOT NULL,
  status       TEXT NOT NULL,            -- 'ok' | 'error' | 'missed'
  error        TEXT,
  message_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_schedule ON schedule_runs (schedule_id, ran_at DESC);

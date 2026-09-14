CREATE TABLE IF NOT EXISTS auto_reply_rules (
  id              TEXT PRIMARY KEY,
  profile         TEXT NOT NULL,
  session         TEXT NOT NULL,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 0,      -- lower runs first; first matching rule wins
  scope           TEXT NOT NULL DEFAULT 'dm',      -- 'dm' | 'groups' | 'all' | 'chats'
  chat_ids        TEXT,                            -- JSON array when scope = 'chats'
  hours_from      TEXT,                            -- 'HH:MM' local; NULL = any time
  hours_to        TEXT,                            -- window may wrap past midnight
  weekdays        TEXT,                            -- '0,1,2' (Sun=0); NULL = every day
  match_kind      TEXT NOT NULL DEFAULT 'any',     -- 'any' | 'keywords' | 'regex'
  pattern         TEXT,                            -- comma-separated keywords, or a regex
  reply_kind      TEXT NOT NULL DEFAULT 'text',    -- 'text' | 'ai'
  text            TEXT,                            -- template: {name} {phone} {time} {date}
  ai_instructions TEXT,                            -- knowledge / FAQ / tone for AI replies
  ai_context      INTEGER NOT NULL DEFAULT 10,     -- recent messages given to the model
  cooldown_min    INTEGER NOT NULL DEFAULT 60,     -- per chat; 0 = reply to every message
  quote           INTEGER NOT NULL DEFAULT 1,      -- reply as a quoted reply
  mark_seen       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  replies         INTEGER NOT NULL DEFAULT 0,
  last_run        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_profile ON auto_reply_rules (profile, session, enabled, priority);

CREATE TABLE IF NOT EXISTS auto_reply_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id   TEXT NOT NULL,
  session   TEXT NOT NULL,
  chat_id   TEXT NOT NULL,
  chat_name TEXT,
  incoming  TEXT,
  reply     TEXT,
  status    TEXT NOT NULL,                        -- 'sent' | 'error'
  error     TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_reply_log_rule_chat ON auto_reply_log (rule_id, chat_id, at);
CREATE INDEX IF NOT EXISTS idx_auto_reply_log_at ON auto_reply_log (at);

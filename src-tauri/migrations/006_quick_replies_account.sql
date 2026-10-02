-- Quick replies are keyed by account now (`waha:<profile>:<session>` / `native:<id>`), so one
-- reply can serve a WAHA session, a native number, or every account (NULL). Legacy rows that
-- were limited to a whole server keep that meaning via the `waha:<profile>:*` scope.
ALTER TABLE quick_replies RENAME TO quick_replies_old;
CREATE TABLE quick_replies (
  id         TEXT PRIMARY KEY,
  account    TEXT,
  shortcut   TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO quick_replies (id, account, shortcut, text, created_at)
  SELECT id,
         CASE WHEN session IS NOT NULL THEN 'waha:' || profile || ':' || session
              ELSE 'waha:' || profile || ':*' END,
         shortcut, text, created_at
  FROM quick_replies_old;
DROP TABLE quick_replies_old;
CREATE INDEX IF NOT EXISTS idx_quick_replies_shortcut ON quick_replies (shortcut);

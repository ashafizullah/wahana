-- Schedules, broadcasts and auto-reply rules now belong to an account
-- (`waha:<profileId>:<session>` or `native:<accountId>`), so they can target native
-- numbers as well as WAHA sessions. The legacy profile/session columns stay for backups.
ALTER TABLE schedules        ADD COLUMN account TEXT;
ALTER TABLE broadcasts       ADD COLUMN account TEXT;
ALTER TABLE auto_reply_rules ADD COLUMN account TEXT;
ALTER TABLE auto_reply_log   ADD COLUMN account TEXT;

UPDATE schedules        SET account = 'waha:' || profile || ':' || session WHERE account IS NULL;
UPDATE broadcasts       SET account = 'waha:' || profile || ':' || session WHERE account IS NULL;
UPDATE auto_reply_rules SET account = 'waha:' || profile || ':' || session WHERE account IS NULL;
UPDATE auto_reply_log   SET account = COALESCE(
  (SELECT r.account FROM auto_reply_rules r WHERE r.id = auto_reply_log.rule_id),
  'waha:' || session
) WHERE account IS NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_account ON schedules (account, enabled, next_run);
CREATE INDEX IF NOT EXISTS idx_broadcasts_account ON broadcasts (account, status);
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_account ON auto_reply_rules (account, enabled, priority);

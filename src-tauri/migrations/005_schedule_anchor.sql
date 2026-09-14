-- The originally chosen first-run time of a schedule. Monthly repeats take their
-- day-of-month from it (next_run drifts: a "31st" clamped to Feb 28 would stay on the 28th).
ALTER TABLE schedules ADD COLUMN anchor INTEGER;
UPDATE schedules SET anchor = next_run WHERE anchor IS NULL;

-- The auto-reply loop guard filters by (session, chat_id, at) on every incoming message.
CREATE INDEX IF NOT EXISTS idx_auto_reply_log_session_chat ON auto_reply_log (session, chat_id, at);

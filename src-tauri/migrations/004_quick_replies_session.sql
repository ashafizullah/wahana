-- Quick replies can be limited to one session (business / number); NULL = every session.
ALTER TABLE quick_replies ADD COLUMN session TEXT;

BEGIN;

ALTER TABLE cadence_steps
  ADD COLUMN IF NOT EXISTS reply_type TEXT NOT NULL DEFAULT 'new_conversation'
    CHECK (reply_type IN ('new_conversation', 'reply'));

COMMIT;

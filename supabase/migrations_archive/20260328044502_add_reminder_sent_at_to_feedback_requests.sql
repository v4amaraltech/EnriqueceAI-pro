BEGIN;

ALTER TABLE closer_feedback_requests ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMIT;

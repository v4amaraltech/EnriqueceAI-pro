-- Robustness improvements for closer feedback reminders
-- 1. Track reminder count (allow up to 3 reminders, not just one)
-- 2. Reframe reminder_sent_at as "last_reminder_at" semantically
BEGIN;

ALTER TABLE closer_feedback_requests
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN closer_feedback_requests.reminder_sent_at IS 'Timestamp of last reminder sent (multiple reminders allowed)';
COMMENT ON COLUMN closer_feedback_requests.reminder_count IS 'How many reminders have been sent so far (max 3)';

-- Backfill: existing records with reminder_sent_at had exactly 1 reminder
UPDATE closer_feedback_requests
SET reminder_count = 1
WHERE reminder_sent_at IS NOT NULL AND reminder_count = 0;

COMMIT;

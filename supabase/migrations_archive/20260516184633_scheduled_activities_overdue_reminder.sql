-- Adds idempotency column for "overdue return" WhatsApp alerts.
--
-- Background: the activity-reminders cron already notifies the SDR's
-- in-app bell 30min BEFORE a scheduled return fires. But there was no
-- signal once a return crossed past its scheduled time. SDRs were
-- silently building up backlog on the Retornos tab.
--
-- New behavior (in /api/cron/activity-reminders): when a pending
-- scheduled_activity has scheduled_at older than (now - 2h), send a
-- WhatsApp DM to the SDR's personal number (taken from their connected
-- whatsapp_instances row) and stamp overdue_reminder_sent_at so the same
-- activity isn't pinged again on the next cron tick.

BEGIN;

ALTER TABLE scheduled_activities
  ADD COLUMN IF NOT EXISTS overdue_reminder_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN scheduled_activities.overdue_reminder_sent_at IS
  'Timestamp da notificação WhatsApp de retorno atrasado. NULL = nunca notificado. Preenchido pelo cron activity-reminders quando scheduled_at < now-2h.';

-- Partial index for the cron lookup: only rows still waiting for an
-- overdue ping. Keeps the cron query trivially cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_scheduled_activities_pending_overdue
  ON scheduled_activities (scheduled_at)
  WHERE status = 'pending' AND overdue_reminder_sent_at IS NULL;

COMMIT;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'activity_reminder';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meeting_reminder';

-- Track when reminder was sent for scheduled activities
ALTER TABLE scheduled_activities ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Cron job: check for upcoming activities/meetings every 5 minutes and send reminders
SELECT cron.schedule(
  'activity-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.app_url', true) || '/api/cron/activity-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

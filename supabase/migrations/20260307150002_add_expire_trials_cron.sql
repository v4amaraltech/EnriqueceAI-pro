BEGIN;

-- Daily cron at 06:00 UTC to expire trials via API route
SELECT cron.schedule(
  'expire-trials',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.app_url', true) || '/api/cron/expire-trials',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMIT;

BEGIN;

-- Versioning the expire-inactive-leads cron. The job was created out-of-band
-- (manual cron.schedule call) so it lived in DB but not in the repo, and the
-- bearer token was hardcoded. Re-creates idempotently using current_setting()
-- for app_url and cron_secret, matching every other cron migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-inactive-leads') THEN
    PERFORM cron.unschedule('expire-inactive-leads');
  END IF;
END $$;

-- 07h UTC = 04h BRT, daily
SELECT cron.schedule(
  'expire-inactive-leads',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.app_url') || '/api/cron/expire-inactive-leads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMIT;

BEGIN;

-- Versioning the sdr-overdue-summary cron in migration history. The schedule
-- was created out-of-band (manual cron.schedule call) so it was not tracked
-- in the repo. We unschedule any existing instance and re-create it using the
-- same current_setting() pattern other crons use, so the job moves with
-- env config (app_url + cron_secret) instead of a hardcoded bearer token.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sdr-overdue-summary') THEN
    PERFORM cron.unschedule('sdr-overdue-summary');
  END IF;
END $$;

-- 08h BRT (11h UTC) seg-sex
SELECT cron.schedule(
  'sdr-overdue-summary',
  '0 11 * * 1-5',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.app_url') || '/api/cron/sdr-overdue-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMIT;

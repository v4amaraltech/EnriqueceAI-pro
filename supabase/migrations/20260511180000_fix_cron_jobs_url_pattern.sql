-- Two crons (sdr-overdue-summary, expire-inactive-leads) were scheduled with
-- `current_setting('app.settings.app_url')` (without missing_ok=true). Supabase
-- hosted PostgreSQL does not allow ALTER DATABASE SET, so those parameters
-- never get populated — every cron tick failed with:
--   ERROR: unrecognized configuration parameter "app.settings.app_url"
--
-- Production was already patched via direct `cron.unschedule + cron.schedule`
-- with hardcoded URL (matching the 12 other crons in the system which all do
-- the same). This migration enforces that pattern idempotently so re-deploys
-- and fresh environments don't recreate the bug.
--
-- Bearer tokens are NOT in this migration to avoid leaking secrets into git;
-- production retains its existing token from the out-of-band fix. For new
-- environments, replace the placeholder below before applying or apply the
-- migration and then run `cron.alter_job` to set the real token.

BEGIN;

DO $$
DECLARE
  current_cmd TEXT;
BEGIN
  -- sdr-overdue-summary
  SELECT command INTO current_cmd FROM cron.job WHERE jobname = 'sdr-overdue-summary';
  IF current_cmd IS NOT NULL AND current_cmd LIKE '%current_setting(''app.settings.app_url''%' THEN
    PERFORM cron.unschedule('sdr-overdue-summary');
    PERFORM cron.schedule(
      'sdr-overdue-summary',
      '0 11 * * 1-5',
      $cron$
      SELECT net.http_post(
        url := 'https://app.enriqueceai.com.br/api/cron/sdr-overdue-summary',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;

  -- expire-inactive-leads
  SELECT command INTO current_cmd FROM cron.job WHERE jobname = 'expire-inactive-leads';
  IF current_cmd IS NOT NULL AND current_cmd LIKE '%current_setting(''app.settings.app_url''%' THEN
    PERFORM cron.unschedule('expire-inactive-leads');
    PERFORM cron.schedule(
      'expire-inactive-leads',
      '0 7 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://app.enriqueceai.com.br/api/cron/expire-inactive-leads',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;

COMMIT;

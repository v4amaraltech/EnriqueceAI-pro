-- Schedule the workers health-check cron — checks worker_run_state for
-- stale critical workers and notifies org managers when one stops
-- completing successfully.
--
-- Runs every 2h. The reconcile-api4com-calls worker runs hourly and we
-- alert at 3h staleness, so 2h cadence catches the failure within one
-- check window.

BEGIN;

DO $$
DECLARE
  template_command TEXT;
  new_command TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'health-check-workers') THEN
    RAISE NOTICE 'health-check-workers already scheduled, skipping';
    RETURN;
  END IF;

  SELECT command INTO template_command
  FROM cron.job
  WHERE jobname = 'daily-cadence-summary'
  LIMIT 1;

  IF template_command IS NULL THEN
    RAISE EXCEPTION 'Template cron daily-cadence-summary not found — cannot derive header';
  END IF;

  new_command := replace(
    template_command,
    'https://app.enriqueceai.com.br/api/cron/daily-cadence-summary',
    'https://app.enriqueceai.com.br/api/cron/health-check-workers'
  );

  PERFORM cron.schedule('health-check-workers', '0 */2 * * *', new_command);
END;
$$;

COMMIT;

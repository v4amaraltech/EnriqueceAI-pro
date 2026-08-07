-- CSV imports occasionally exceed Vercel's function timeout. The server
-- action dies before flipping lead_imports.status from 'processing' to a
-- final state, and the row sits in 'processing' forever — the UI keeps
-- showing the eternal spinner. Manually cleaned 6 of these over the last
-- 2 days.
--
-- Schedule the reaper /api/cron/reap-stuck-imports every 10 min. With a
-- 15-min staleness threshold inside the worker, anything still in
-- 'processing' after 15+ min is reconciled from the actual side effects.

BEGIN;

DO $$
DECLARE
  template_command TEXT;
  new_command TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reap-stuck-imports') THEN
    RAISE NOTICE 'reap-stuck-imports already scheduled, skipping';
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
    'https://app.enriqueceai.com.br/api/cron/reap-stuck-imports'
  );

  PERFORM cron.schedule('reap-stuck-imports', '*/10 * * * *', new_command);
END;
$$;

COMMIT;

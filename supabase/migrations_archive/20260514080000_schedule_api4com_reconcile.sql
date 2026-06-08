-- Reconciliation worker /api/workers/reconcile-api4com-calls is in place
-- and validated. Wire the cron so it runs every hour without manual curl.
--
-- Window = 1.5h (default in the worker) gives a 30-min overlap with the
-- previous run, covering any call that ended close to the previous cron's
-- cutoff. Upserts are idempotent (match by metadata->>api4com_call_id),
-- so the overlap doesn't double-insert.
--
-- The command body is copied verbatim from an existing cron so the Bearer
-- token stays out of this migration file. windowHours is omitted so the
-- worker uses its DEFAULT_WINDOW_HOURS=1.5 default.

BEGIN;

DO $$
DECLARE
  template_command TEXT;
  new_command TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-api4com-calls') THEN
    RAISE NOTICE 'reconcile-api4com-calls already scheduled, skipping';
    RETURN;
  END IF;

  -- Borrow command from an existing peer cron — they share the same Bearer
  -- header and JSON envelope shape. Replace the URL and body.
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
    'https://app.enriqueceai.com.br/api/workers/reconcile-api4com-calls'
  );
  -- Body stays as '{}'::jsonb — the worker defaults to all orgs +
  -- windowHours=1.5 when the body is empty.

  PERFORM cron.schedule('reconcile-api4com-calls', '0 * * * *', new_command);
END;
$$;

COMMIT;

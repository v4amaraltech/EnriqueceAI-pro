-- The /api/cron/check-google-connections route handler exists complete with
-- cron secret auth, 24h cooldown, and a maxDuration suited for cron use, but
-- no pg_cron job ever invokes it. SDRs whose Google Calendar/Gmail
-- connection lands in 'error' state silently lose meeting scheduling and
-- email sends until they notice.
--
-- Schedule it daily at 11:00 UTC (8:00 BRT) — early in the SDR workday so a
-- broken integration shows up before the first outreach push. We avoid the
-- midnight slot to dodge contention with cleanup jobs that run between 3:00
-- and 6:00 UTC.
--
-- The command body is copied verbatim from an existing cron (just with the
-- URL swapped) so the Bearer header stays in sync with the other jobs and
-- never lands in this migration file.

BEGIN;

DO $$
DECLARE
  template_command TEXT;
  new_command TEXT;
BEGIN
  -- Refuse to register twice — alter the schedule if it already exists.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-google-connections') THEN
    RAISE NOTICE 'check-google-connections already scheduled, skipping';
    RETURN;
  END IF;

  -- Borrow command from any peer cron — they all share the same Bearer
  -- header and JSON envelope.
  SELECT command INTO template_command
  FROM cron.job
  WHERE jobname = 'daily-cadence-summary'
  LIMIT 1;

  IF template_command IS NULL THEN
    RAISE EXCEPTION 'Template cron daily-cadence-summary not found — cannot derive header for check-google-connections';
  END IF;

  -- Swap the URL while keeping headers/body intact.
  new_command := replace(
    template_command,
    'https://app.enriqueceai.com.br/api/cron/daily-cadence-summary',
    'https://app.enriqueceai.com.br/api/cron/check-google-connections'
  );

  PERFORM cron.schedule('check-google-connections', '0 11 * * *', new_command);
END;
$$;

COMMIT;

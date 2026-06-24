-- When a lead moves to a terminal state (won / unqualified / archived) the
-- cadence enrollment should stop firing. Today nothing closes the enrollment
-- — execute-cadence-steps just keeps querying the lead and the only thing
-- saving us from sending mails to closed leads is a separate "is lead alive?"
-- filter in the cron. The enrollment row stays 'active' forever, polluting
-- reports and stuck-lead audits.
--
-- 12 V4 Amaral enrollments currently sit 'active' on dead leads.
--
-- Trigger fires AFTER UPDATE OF status so it sees the new value, and only
-- when the status actually changed (IS DISTINCT FROM guard). On INSERT we
-- skip — a lead created already-dead won't have an active enrollment yet.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_enrollments_on_terminal_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.status IN ('won', 'unqualified', 'archived')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE cadence_enrollments
    SET status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE lead_id = NEW.id
      AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.close_enrollments_on_terminal_lead() IS
  'AFTER UPDATE trigger on leads. Marks active/paused enrollments as completed when the lead transitions to a terminal state (won, unqualified, archived).';

DROP TRIGGER IF EXISTS close_enrollments_on_terminal_lead_trigger ON leads;

CREATE TRIGGER close_enrollments_on_terminal_lead_trigger
  AFTER UPDATE OF status ON leads
  FOR EACH ROW
  EXECUTE FUNCTION close_enrollments_on_terminal_lead();

-- Backfill: close every enrollment whose lead is already terminal.
UPDATE cadence_enrollments
SET status = 'completed',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE status IN ('active', 'paused')
  AND lead_id IN (
    SELECT id FROM leads WHERE status IN ('won', 'unqualified', 'archived')
  );

COMMIT;

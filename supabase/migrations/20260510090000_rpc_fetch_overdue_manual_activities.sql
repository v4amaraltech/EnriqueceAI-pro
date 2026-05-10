-- Helper RPC for the daily SDR overdue-summary cron. Returns one row per
-- enrollment that is active, overdue >24h, assigned to a lead with an owner,
-- and parked on a manual channel (whatsapp / phone / research / linkedin —
-- email steps auto-execute via the cadence cron and never linger).

CREATE OR REPLACE FUNCTION public.fetch_overdue_manual_activities()
RETURNS TABLE (
  lead_id uuid,
  assigned_to uuid,
  org_id uuid,
  channel text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT l.id AS lead_id,
         l.assigned_to,
         l.org_id,
         cs.channel::text AS channel
  FROM cadence_enrollments ce
  JOIN cadences c        ON c.id = ce.cadence_id
  JOIN leads l           ON l.id = ce.lead_id
  JOIN cadence_steps cs  ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
  WHERE ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND ce.next_step_due < now() - interval '24 hours'
    AND cs.channel::text <> 'email'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.fetch_overdue_manual_activities() FROM anon, authenticated;

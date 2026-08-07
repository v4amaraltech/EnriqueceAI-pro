BEGIN;

-- View used by the "Sem cadência" filter on /leads.
-- Replaces a round-trip that built an IN(...) clause with thousands of UUIDs
-- and exceeded the PostgREST URL length limit on orgs with many leads.
-- security_invoker=true keeps RLS on the underlying tables enforced.

CREATE OR REPLACE VIEW public.leads_no_active_enrollment
WITH (security_invoker = true) AS
SELECT l.*
FROM leads l
WHERE NOT EXISTS (
  SELECT 1
  FROM cadence_enrollments ce
  WHERE ce.lead_id = l.id
    AND ce.status IN ('active', 'paused')
);

COMMENT ON VIEW public.leads_no_active_enrollment IS 'Leads sem nenhuma enrollment ativa/pausada. Usado pelo filtro "Sem cadência".';

GRANT SELECT ON public.leads_no_active_enrollment TO authenticated;

COMMIT;

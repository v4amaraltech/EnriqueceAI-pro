BEGIN;

-- Helper function: get the lead_visibility_mode for the current user's org
CREATE OR REPLACE FUNCTION public.lead_visibility_mode()
RETURNS TEXT AS $$
  SELECT lead_visibility_mode
  FROM organizations
  WHERE id = public.user_org_id()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Update leads SELECT policy to respect lead_visibility_mode
-- Modes:
--   'all'  → all org members see all leads
--   'own'  → SDRs see only leads assigned to them; managers see all
--   'team' → same as 'own' for now (team-based requires a teams table, future feature)
DROP POLICY IF EXISTS "leads_org_read" ON leads;
CREATE POLICY "leads_org_read" ON leads FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND (
      public.is_manager()
      OR public.lead_visibility_mode() = 'all'
      OR (public.lead_visibility_mode() IN ('own', 'team') AND assigned_to = auth.uid())
    )
  );

-- Update leads UPDATE policy to match
DROP POLICY IF EXISTS "leads_org_update" ON leads;
CREATE POLICY "leads_org_update" ON leads FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND (
      public.is_manager()
      OR public.lead_visibility_mode() = 'all'
      OR (public.lead_visibility_mode() IN ('own', 'team') AND assigned_to = auth.uid())
    )
  );

COMMIT;

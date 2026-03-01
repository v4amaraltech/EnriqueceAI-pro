BEGIN;

-- SDR Isolation: SDRs see ONLY leads explicitly assigned to them.
-- Managers see all leads in the organization (including unassigned).
-- Unassigned leads (assigned_to IS NULL) are only visible to managers.

-- SELECT: Manager sees all org leads, SDR sees only assigned_to=uid
DROP POLICY IF EXISTS "leads_org_read" ON leads;
CREATE POLICY "leads_org_read" ON leads FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND (
      public.is_manager()
      OR assigned_to = auth.uid()
    )
  );

-- UPDATE: Manager updates any org lead, SDR only their assigned leads
DROP POLICY IF EXISTS "leads_org_update" ON leads;
CREATE POLICY "leads_org_update" ON leads FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND (
      public.is_manager()
      OR assigned_to = auth.uid()
    )
  );

-- INSERT and DELETE policies remain unchanged (org-level)

-- Optimized index for SDR isolation queries
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_org
  ON leads(org_id, assigned_to) WHERE deleted_at IS NULL;

COMMIT;

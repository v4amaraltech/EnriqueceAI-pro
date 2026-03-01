BEGIN;

-- Fix: Remove "assigned_to IS NULL" from SDR visibility.
-- SDRs must see ONLY leads explicitly assigned to them.
-- Unassigned leads are visible only to managers.

DROP POLICY IF EXISTS "leads_org_read" ON leads;
CREATE POLICY "leads_org_read" ON leads FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND (
      public.is_manager()
      OR assigned_to = auth.uid()
    )
  );

COMMIT;

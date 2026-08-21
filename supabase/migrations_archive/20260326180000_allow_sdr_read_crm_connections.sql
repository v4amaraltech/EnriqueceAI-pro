BEGIN;

-- Allow all org members (including SDRs) to read CRM connections.
-- Write operations (INSERT, UPDATE, DELETE) remain manager-only.
DROP POLICY IF EXISTS "crm_manager_read" ON crm_connections;

CREATE POLICY "crm_org_read" ON crm_connections FOR SELECT
  USING (org_id = public.user_org_id());

COMMIT;

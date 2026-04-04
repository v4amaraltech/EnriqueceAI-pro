BEGIN;

-- =============================================================================
-- Backend Audit Fixes — 2026-04-04
-- Items: provider_events retention, ldr_pipeline_log indexes, goals RLS
-- =============================================================================

-- Item 1: Retention cron for provider_events (daily at 3am UTC, keep 7 days)
SELECT cron.schedule(
  'cleanup-provider-events',
  '0 3 * * *',
  $$DELETE FROM provider_events WHERE processed_at < now() - interval '7 days'$$
);

-- Item 2: Missing indexes on ldr_pipeline_log FKs
CREATE INDEX IF NOT EXISTS idx_ldr_pipeline_log_empresa_id ON ldr_pipeline_log (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ldr_pipeline_log_socio_id ON ldr_pipeline_log (socio_id);

-- Item 3: Fix goals RLS — replace permissive ALL with proper CRUD (manager-only writes)
DROP POLICY IF EXISTS goals_org_access ON goals;

CREATE POLICY goals_org_select ON goals
  FOR SELECT USING (org_id = user_org_id());
CREATE POLICY goals_org_insert ON goals
  FOR INSERT WITH CHECK (org_id = user_org_id() AND is_manager());
CREATE POLICY goals_org_update ON goals
  FOR UPDATE USING (org_id = user_org_id() AND is_manager());
CREATE POLICY goals_org_delete ON goals
  FOR DELETE USING (org_id = user_org_id() AND is_manager());

-- Same fix for goals_per_user
DROP POLICY IF EXISTS goals_per_user_org_access ON goals_per_user;

CREATE POLICY goals_per_user_org_select ON goals_per_user
  FOR SELECT USING (org_id = user_org_id());
CREATE POLICY goals_per_user_org_insert ON goals_per_user
  FOR INSERT WITH CHECK (org_id = user_org_id() AND is_manager());
CREATE POLICY goals_per_user_org_update ON goals_per_user
  FOR UPDATE USING (org_id = user_org_id() AND is_manager());
CREATE POLICY goals_per_user_org_delete ON goals_per_user
  FOR DELETE USING (org_id = user_org_id() AND is_manager());

COMMIT;

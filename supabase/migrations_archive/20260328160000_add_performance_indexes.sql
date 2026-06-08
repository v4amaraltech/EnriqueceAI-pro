BEGIN;

-- Index for filtering enrollments by enrolled_by (used in team/cadence analytics)
CREATE INDEX IF NOT EXISTS idx_enrollments_enrolled_by
  ON cadence_enrollments (enrolled_by)
  WHERE enrolled_by IS NOT NULL;

-- Composite index for filtering leads by creator within org (used in team analytics)
CREATE INDEX IF NOT EXISTS idx_leads_created_by
  ON leads (org_id, created_by)
  WHERE created_by IS NOT NULL AND deleted_at IS NULL;

-- Composite index for filtering interactions by performer within org (replaces single-column idx_interactions_performed_by)
CREATE INDEX IF NOT EXISTS idx_interactions_performed_by_org
  ON interactions (org_id, performed_by)
  WHERE performed_by IS NOT NULL;

COMMIT;

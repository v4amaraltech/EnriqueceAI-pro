BEGIN;

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN interactions.performed_by IS 'User who performed/triggered this interaction (NULL for auto-executed cron steps)';

CREATE INDEX IF NOT EXISTS idx_interactions_performed_by ON interactions (performed_by)
  WHERE performed_by IS NOT NULL;

COMMIT;

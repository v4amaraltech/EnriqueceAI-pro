BEGIN;

-- Add org_id to cadence_enrollments to eliminate indirect queries via cadences
ALTER TABLE cadence_enrollments ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill from cadences table
UPDATE cadence_enrollments ce
SET org_id = c.org_id
FROM cadences c
WHERE ce.cadence_id = c.id AND ce.org_id IS NULL;

-- Make NOT NULL
ALTER TABLE cadence_enrollments ALTER COLUMN org_id SET NOT NULL;

-- Index for fast org-scoped queries
CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_org_id ON cadence_enrollments (org_id);

-- Index on phone suffix for duplicate detection
CREATE INDEX IF NOT EXISTS idx_leads_phone_suffix
ON leads (right(regexp_replace(telefone, '\D', '', 'g'), 8))
WHERE telefone IS NOT NULL AND deleted_at IS NULL;

-- Auto-complete enrollments when cadence is soft-deleted
CREATE OR REPLACE FUNCTION complete_enrollments_on_cadence_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE cadence_enrollments
    SET status = 'completed', completed_at = now()
    WHERE cadence_id = NEW.id AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_complete_enrollments_on_cadence_delete ON cadences;
CREATE TRIGGER trg_complete_enrollments_on_cadence_delete
  AFTER UPDATE ON cadences
  FOR EACH ROW
  EXECUTE FUNCTION complete_enrollments_on_cadence_delete();

COMMIT;

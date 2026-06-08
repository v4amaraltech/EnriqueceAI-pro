BEGIN;

-- Add won_at column to track when a lead was marked as won (qualified)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ;

-- Backfill: use lead_won interaction timestamp as source of truth
UPDATE leads l
SET won_at = i.created_at
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, created_at
  FROM interactions
  WHERE channel = 'system'
    AND metadata->>'system_event' = 'lead_won'
  ORDER BY lead_id, created_at DESC
) i
WHERE l.id = i.lead_id
  AND l.status = 'qualified'
  AND l.won_at IS NULL;

-- Create trigger function to auto-set won_at when status changes to 'qualified'
CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'qualified' AND (OLD.status IS DISTINCT FROM 'qualified') THEN
    NEW.won_at = now();
  END IF;
  -- Clear won_at if lead is moved out of qualified status
  IF NEW.status != 'qualified' AND OLD.status = 'qualified' THEN
    NEW.won_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_qualified_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION set_qualified_at();

-- Index for dashboard queries filtering by won_at
CREATE INDEX IF NOT EXISTS idx_leads_won_at ON leads (org_id, won_at)
  WHERE status = 'qualified' AND deleted_at IS NULL;

COMMIT;

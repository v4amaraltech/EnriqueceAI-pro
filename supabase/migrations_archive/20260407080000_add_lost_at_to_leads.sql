BEGIN;

-- Add lost_at column to track when a lead was marked as lost (unqualified)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

-- Backfill from lead_lost interaction timestamps
UPDATE leads l
SET lost_at = i.created_at
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, created_at
  FROM interactions
  WHERE channel = 'system'
    AND metadata->>'system_event' = 'lead_lost'
  ORDER BY lead_id, created_at DESC
) i
WHERE l.id = i.lead_id
  AND l.status = 'unqualified'
  AND l.lost_at IS NULL;

-- Update trigger to handle both won_at and lost_at
CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'qualified' AND (OLD.status IS DISTINCT FROM 'qualified') THEN
    NEW.won_at = now();
  END IF;
  IF NEW.status != 'qualified' AND OLD.status = 'qualified' THEN
    NEW.won_at = NULL;
  END IF;
  IF NEW.status = 'unqualified' AND (OLD.status IS DISTINCT FROM 'unqualified') THEN
    NEW.lost_at = now();
  END IF;
  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Index for lost_at queries
CREATE INDEX IF NOT EXISTS idx_leads_lost_at ON leads (org_id, lost_at)
  WHERE status = 'unqualified' AND deleted_at IS NULL;

COMMIT;

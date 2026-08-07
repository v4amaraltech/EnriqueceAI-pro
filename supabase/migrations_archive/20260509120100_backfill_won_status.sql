-- Backfill leads.status = 'won' for leads that already have meeting_held_at set
-- (closer confirmed result=meeting_done in /api/feedback). Update the trigger
-- so future writes to meeting_held_at automatically promote status to 'won'.

BEGIN;

-- 1. Backfill: leads already in 'qualified' with a confirmed meeting → 'won'.
UPDATE leads
SET status = 'won'
WHERE status = 'qualified'
  AND meeting_held_at IS NOT NULL
  AND deleted_at IS NULL;

-- 2. Replace trigger function so it:
--    - keeps lost_at behavior for 'unqualified'
--    - promotes status to 'won' (and stamps won_at) when meeting_held_at is set
--    - reverts to 'qualified' (clears won_at) when meeting_held_at is unset
--    - no longer stamps won_at on the qualified→qualified transition (that's
--      now driven exclusively by meeting_held_at, matching the /api/feedback flow)
CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Closer confirmed the meeting happened: promote to 'won'.
  IF NEW.meeting_held_at IS NOT NULL
     AND (OLD.meeting_held_at IS NULL OR OLD.meeting_held_at IS DISTINCT FROM NEW.meeting_held_at) THEN
    NEW.status := 'won';
    NEW.won_at := NEW.meeting_held_at;
  END IF;

  -- Meeting confirmation rolled back: revert from 'won' back to 'qualified'.
  IF NEW.meeting_held_at IS NULL AND OLD.meeting_held_at IS NOT NULL THEN
    IF NEW.status = 'won' THEN
      NEW.status := 'qualified';
    END IF;
    NEW.won_at := NULL;
  END IF;

  -- Lost-status timestamps (unchanged behavior from previous trigger).
  IF NEW.status = 'unqualified' AND OLD.status IS DISTINCT FROM 'unqualified' THEN
    NEW.lost_at := now();
  END IF;
  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Update partial index to cover the new status.
DROP INDEX IF EXISTS idx_leads_won_at;
CREATE INDEX IF NOT EXISTS idx_leads_won_at ON leads (org_id, won_at)
  WHERE status = 'won' AND deleted_at IS NULL;

COMMIT;

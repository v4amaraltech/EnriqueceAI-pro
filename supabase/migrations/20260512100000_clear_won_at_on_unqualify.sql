-- Trigger asymmetry fix: the previous revisions of set_qualified_at stamp
-- lost_at when entering 'unqualified' and clear lost_at when leaving, but
-- never touched won_at on that transition. Result: a lead that was marked
-- ganho and later marked perdido carried won_at into the unqualified state,
-- inflating the won metric (won_at IS NOT NULL was used as a "is won" filter
-- in older code paths) and leaving the timeline contradictory.
--
-- One lead in production today: "Storge" (V4 Amaral, edeea135) — status
-- unqualified with both won_at (2026-05-08) and lost_at (2026-05-07).
-- Cleanup at the end of this migration.

BEGIN;

CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Entering unqualified: stamp lost_at and clear any won-related stamps so
  -- the lead state is consistent.
  IF NEW.status = 'unqualified' AND OLD.status IS DISTINCT FROM 'unqualified' THEN
    NEW.lost_at := now();
    NEW.won_at := NULL;
    NEW.meeting_held_at := NULL;
  END IF;

  -- Leaving unqualified: clear lost_at. Won-related stamps are intentionally
  -- NOT restored here — the reopen path (UI button) sets them explicitly when
  -- needed.
  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One-off cleanup for the lead already in a contradictory state.
UPDATE leads
SET won_at = NULL,
    meeting_held_at = NULL
WHERE status = 'unqualified'
  AND deleted_at IS NULL
  AND won_at IS NOT NULL;

COMMIT;

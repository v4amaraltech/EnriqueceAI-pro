-- Revert the auto-promote behavior introduced on 2026-05-09. That model
-- (SDR marks "ganho" → status=qualified, closer must confirm meeting_done
-- → trigger promotes to won) broke the production flow: SDRs saw their
-- ganho clicks silently stuck in 'qualified', and leads whose closer
-- never responded the feedback link sat there forever invisible to the
-- "won" metric.
--
-- New (= old, restored) model — Meetime-style:
--   - SDR clicks "Ganho" in the UI → status='won' immediately + push CRM.
--     SDR's production is "fazer a reunião acontecer + enviar pro Kommo".
--   - Closer feedback (meeting_done / no_show / rescheduled) keeps stamping
--     meeting_held_at and rating, but does NOT control lead status. The
--     feedback dataset is used to track SAL quality (held-rate, closer
--     rejection rate), not lead lifecycle.
--
-- Trigger keeps the lost_at stamping behavior. Drops the meeting_held_at
-- promotion / demotion branches.

BEGIN;

CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Lost-status timestamps: stamp lost_at when entering 'unqualified',
  -- clear it when leaving. Unchanged from the original behavior.
  IF NEW.status = 'unqualified' AND OLD.status IS DISTINCT FROM 'unqualified' THEN
    NEW.lost_at := now();
  END IF;
  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill: promote to 'won' every lead currently stuck in 'qualified'
-- that already had a 'lead_won' system_event (SDR clicked Ganho but the
-- trigger never promoted because closer didn't respond feedback). 8 leads
-- in V4 Amaral as of this migration; the count is small org-wide.
UPDATE leads
SET status = 'won',
    won_at = COALESCE(won_at, updated_at)
WHERE status = 'qualified'
  AND deleted_at IS NULL
  AND id IN (
    SELECT DISTINCT lead_id
    FROM interactions
    WHERE metadata->>'system_event' = 'lead_won'
  );

COMMIT;

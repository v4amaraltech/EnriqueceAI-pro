BEGIN;

-- Fix active enrollments with NULL next_step_due
-- These get stuck because the query uses .lte('next_step_due', now())
-- which excludes NULLs. Set them to now() so they execute on the next cron run.
UPDATE cadence_enrollments
SET next_step_due = now()
WHERE status = 'active'
  AND next_step_due IS NULL;

-- Also improve the trigger to handle the paused→active transition
-- When enrollment is resumed (paused→active), recalculate next_step_due
CREATE OR REPLACE FUNCTION calculate_next_step_due()
RETURNS TRIGGER AS $$
DECLARE
  step RECORD;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT delay_days, delay_hours INTO step
    FROM cadence_steps
    WHERE cadence_id = NEW.cadence_id AND step_order = NEW.current_step;

    IF FOUND THEN
      -- For new enrollments (INSERT) or resumed enrollments,
      -- calculate based on delay. For step advances (current_step changed),
      -- also recalculate.
      NEW.next_step_due := now() + make_interval(days => step.delay_days, hours => step.delay_hours);
    ELSE
      -- Step not found — set to now() so the engine can mark as completed
      NEW.next_step_due := now();
    END IF;
  ELSIF NEW.status IN ('completed', 'replied', 'bounced', 'unsubscribed', 'paused') THEN
    NEW.next_step_due := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

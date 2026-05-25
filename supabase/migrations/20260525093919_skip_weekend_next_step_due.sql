BEGIN;

-- Skip weekends when scheduling next_step_due so SDR queues don't show
-- "overdue" tasks on Saturday/Sunday — the team works Mon–Fri only.
-- If the raw due time falls on Saturday/Sunday in America/Sao_Paulo,
-- shift it forward to Monday 09:00 BRT.
CREATE OR REPLACE FUNCTION public.skip_weekend_brt(ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  local_ts timestamp;
  dow int;
BEGIN
  IF ts IS NULL THEN
    RETURN NULL;
  END IF;

  local_ts := ts AT TIME ZONE 'America/Sao_Paulo';
  -- extract dow: 0 = Sunday, 6 = Saturday
  dow := EXTRACT(DOW FROM local_ts)::int;

  IF dow = 6 THEN
    -- Saturday → Monday 09:00 BRT
    RETURN (date_trunc('day', local_ts) + interval '2 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  ELSIF dow = 0 THEN
    -- Sunday → Monday 09:00 BRT
    RETURN (date_trunc('day', local_ts) + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  RETURN ts;
END;
$$;

COMMENT ON FUNCTION public.skip_weekend_brt(timestamptz) IS
  'Empurra timestamps que caem em sábado/domingo (timezone America/Sao_Paulo) para segunda-feira às 09:00 BRT. Usado pelo trigger calculate_next_step_due para evitar tarefas atrasadas em fim de semana.';

-- Update the trigger to apply skip_weekend_brt to the calculated due date.
CREATE OR REPLACE FUNCTION public.calculate_next_step_due()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  step RECORD;
  raw_due timestamptz;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT delay_days, delay_hours INTO step
    FROM cadence_steps
    WHERE cadence_id = NEW.cadence_id AND step_order = NEW.current_step;

    IF FOUND THEN
      raw_due := now() + make_interval(days => step.delay_days, hours => step.delay_hours);
      NEW.next_step_due := public.skip_weekend_brt(raw_due);
    ELSE
      -- Step not found — set to now() so the engine can mark as completed
      NEW.next_step_due := now();
    END IF;
  ELSIF NEW.status IN ('completed', 'replied', 'bounced', 'unsubscribed', 'paused') THEN
    NEW.next_step_due := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: push existing active enrollments whose next_step_due falls on
-- Saturday or Sunday in BRT to Monday 09:00 BRT so SDRs don't see them as
-- overdue on Monday morning.
UPDATE cadence_enrollments
SET next_step_due = public.skip_weekend_brt(next_step_due)
WHERE status = 'active'
  AND next_step_due IS NOT NULL
  AND EXTRACT(DOW FROM (next_step_due AT TIME ZONE 'America/Sao_Paulo'))::int IN (0, 6);

COMMIT;

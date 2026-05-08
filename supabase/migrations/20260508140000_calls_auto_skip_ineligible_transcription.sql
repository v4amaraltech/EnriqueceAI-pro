-- Trigger that auto-marks new ineligible calls as transcription_status='skipped'
-- so they don't accumulate as "pending" forever.
--
-- A call is "obviously ineligible" when, at insert time:
--   - duration_seconds = 0 (call was never connected), OR
--   - status = 'not_connected' AND duration_seconds < 30
--
-- We do NOT mark partial-duration calls (30-180s) as skipped here because the
-- recording_url often arrives via a later webhook update. Those are handled by
-- the cron filter naturally (only picks recording + duration >= threshold).
BEGIN;

CREATE OR REPLACE FUNCTION public.auto_skip_ineligible_call_transcription()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act on initial insert when transcription_status hasn't been set explicitly
  IF NEW.transcription_status IS NOT NULL AND NEW.transcription_status != 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.duration_seconds = 0 THEN
    NEW.transcription_status := 'skipped';
    NEW.transcription_error := 'duration_zero';
  ELSIF NEW.status = 'not_connected' AND NEW.duration_seconds < 30 THEN
    NEW.transcription_status := 'skipped';
    NEW.transcription_error := 'duration_zero';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_skip_ineligible_call_transcription ON calls;

CREATE TRIGGER auto_skip_ineligible_call_transcription
  BEFORE INSERT ON calls
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_skip_ineligible_call_transcription();

COMMIT;

-- "Agendar reunião" gate: SDR shouldn't be able to schedule before the
-- briefing-critical fields are filled. We already have is_required_won /
-- is_required_lost (toggled in Settings → Prospecting), used by the Ganho /
-- Perdido buttons to block submission and prompt for missing data inline.
-- Add the same flag for meetings so the manager picks which fields are
-- non-negotiable before a meeting can be scheduled.

BEGIN;

ALTER TABLE standard_field_settings
  ADD COLUMN IF NOT EXISTS is_required_meeting BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS is_required_meeting BOOLEAN NOT NULL DEFAULT false;

COMMIT;

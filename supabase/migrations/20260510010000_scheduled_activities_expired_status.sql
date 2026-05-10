-- Add 'expired' to scheduled_activities.status. Used by the overdue cleanup
-- path so SDR-scheduled activities that aged past their due date can be
-- silently dropped from the pending queue without overloading 'cancelled'
-- (which means "operator chose to cancel").

BEGIN;

ALTER TABLE scheduled_activities
DROP CONSTRAINT IF EXISTS scheduled_activities_status_check;

ALTER TABLE scheduled_activities
ADD CONSTRAINT scheduled_activities_status_check
CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text, 'expired'::text]));

COMMIT;

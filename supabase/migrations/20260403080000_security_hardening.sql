BEGIN;

-- 1. Add missing DELETE policy on scheduled_activities
CREATE POLICY "Members can delete own scheduled activities"
  ON scheduled_activities FOR DELETE
  USING (org_id = public.user_org_id());

-- 2. Add index on provider_events for faster idempotency lookups
CREATE INDEX IF NOT EXISTS idx_provider_events_provider_event_id
  ON provider_events (provider, event_id);

COMMIT;

BEGIN;

-- Add org_id to webhook_events for multi-tenant traceability
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Add org_id to provider_events for multi-tenant traceability
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- RLS policies for webhook_events (service-role insert, org members can read their own)
CREATE POLICY webhook_events_org_read ON webhook_events FOR SELECT
  USING (org_id IS NULL OR org_id = public.user_org_id());

-- RLS policies for provider_events
CREATE POLICY provider_events_org_read ON provider_events FOR SELECT
  USING (org_id IS NULL OR org_id = public.user_org_id());

COMMIT;

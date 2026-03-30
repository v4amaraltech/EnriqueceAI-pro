BEGIN;

CREATE TABLE scheduled_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel channel_type NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org scheduled activities"
  ON scheduled_activities FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "Members can insert scheduled activities"
  ON scheduled_activities FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "Members can update own scheduled activities"
  ON scheduled_activities FOR UPDATE
  USING (org_id = public.user_org_id());

CREATE INDEX idx_scheduled_activities_lead ON scheduled_activities (lead_id);
CREATE INDEX idx_scheduled_activities_user_pending ON scheduled_activities (user_id, status) WHERE status = 'pending';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduled_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

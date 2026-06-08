BEGIN;

CREATE TABLE activity_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  channel channel_type NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_templates_org_read"
  ON activity_templates FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "activity_templates_org_insert"
  ON activity_templates FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "activity_templates_org_update"
  ON activity_templates FOR UPDATE
  USING (org_id = public.user_org_id());

CREATE POLICY "activity_templates_org_delete"
  ON activity_templates FOR DELETE
  USING (org_id = public.user_org_id());

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON activity_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_activity_templates_org_channel
  ON activity_templates(org_id, channel);

COMMIT;

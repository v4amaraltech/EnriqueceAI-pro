BEGIN;

CREATE TABLE IF NOT EXISTS canal_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE canal_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org canal options"
  ON canal_options FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "Managers can manage canal options"
  ON canal_options FOR ALL
  USING (org_id = public.user_org_id() AND public.is_manager())
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE TRIGGER set_updated_at BEFORE UPDATE ON canal_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

BEGIN;

-- Closers: salespeople who receive leads from SDRs for meetings
CREATE TABLE closers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE closers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON closers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- All org members can read closers (SDRs need to select them)
CREATE POLICY closers_org_read ON closers FOR SELECT
  USING (org_id = public.user_org_id());

-- Only managers can manage closers
CREATE POLICY closers_org_insert ON closers FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY closers_org_update ON closers FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY closers_org_delete ON closers FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

-- Add closer_id to leads table
ALTER TABLE leads ADD COLUMN closer_id UUID REFERENCES closers(id);

COMMIT;

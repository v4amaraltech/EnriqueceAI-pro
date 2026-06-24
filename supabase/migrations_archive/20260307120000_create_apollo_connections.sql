BEGIN;

CREATE TABLE IF NOT EXISTS apollo_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  api_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE apollo_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON apollo_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Managers can manage Apollo connections
CREATE POLICY "managers can manage apollo connections"
  ON apollo_connections FOR ALL
  USING (org_id = public.user_org_id() AND public.is_manager())
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

-- All members can read (needed for search/import)
CREATE POLICY "members can read apollo connections"
  ON apollo_connections FOR SELECT
  USING (org_id = public.user_org_id());

COMMIT;

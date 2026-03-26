BEGIN;

-- API keys for external integrations (inbound leads API, webhooks)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{leads.write}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: org-scoped, managers for write operations
CREATE POLICY "api_keys_select" ON api_keys FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "api_keys_insert" ON api_keys FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "api_keys_update" ON api_keys FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "api_keys_delete" ON api_keys FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

-- Fast lookup by key hash (used in every API request auth)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);

-- Fast lookup for active keys per org
CREATE INDEX IF NOT EXISTS idx_api_keys_org_active ON api_keys (org_id) WHERE is_active = true;

COMMIT;

BEGIN;

-- API4Com VoIP connections (per user per org)
CREATE TABLE IF NOT EXISTS api4com_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ramal TEXT NOT NULL,
  api_key_encrypted TEXT,
  base_url TEXT NOT NULL DEFAULT 'https://api.api4com.com/api/v1/',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

ALTER TABLE api4com_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON api4com_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Users can see their own connection
CREATE POLICY "Users can view own api4com connection"
  ON api4com_connections FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can insert their own connection
CREATE POLICY "Users can insert own api4com connection"
  ON api4com_connections FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can update their own connection
CREATE POLICY "Users can update own api4com connection"
  ON api4com_connections FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can delete their own connection
CREATE POLICY "Users can delete own api4com connection"
  ON api4com_connections FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

COMMIT;

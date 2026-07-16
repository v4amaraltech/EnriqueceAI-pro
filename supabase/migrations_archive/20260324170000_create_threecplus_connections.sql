BEGIN;

-- 3CPlus VoIP connections (per user per org)
CREATE TABLE IF NOT EXISTS threecplus_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  api_token_encrypted TEXT,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

ALTER TABLE threecplus_connections ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON threecplus_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON threecplus_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Users can see their own connection
CREATE POLICY "Users can view own threecplus connection"
  ON threecplus_connections FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can insert their own connection
CREATE POLICY "Users can insert own threecplus connection"
  ON threecplus_connections FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can update their own connection
CREATE POLICY "Users can update own threecplus connection"
  ON threecplus_connections FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

-- Users can delete their own connection
CREATE POLICY "Users can delete own threecplus connection"
  ON threecplus_connections FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND user_id = auth.uid()
  );

COMMIT;

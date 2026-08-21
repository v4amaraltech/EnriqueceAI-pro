BEGIN;

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only managers can read audit logs
CREATE POLICY audit_log_read ON audit_log FOR SELECT
  USING (org_id = public.user_org_id() AND public.is_manager());

-- Insert via service role only (no user-facing insert)

-- Index for common queries
CREATE INDEX idx_audit_log_org_created ON audit_log (org_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log (org_id, action);

COMMIT;

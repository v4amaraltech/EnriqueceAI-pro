BEGIN;

CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: org-scoped access
CREATE POLICY "webhook_endpoints_select" ON webhook_endpoints
  FOR SELECT USING (org_id = public.user_org_id());

CREATE POLICY "webhook_endpoints_insert" ON webhook_endpoints
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "webhook_endpoints_update" ON webhook_endpoints
  FOR UPDATE USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "webhook_endpoints_delete" ON webhook_endpoints
  FOR DELETE USING (org_id = public.user_org_id() AND public.is_manager());

-- Service role needs to read endpoints for dispatch (bypasses RLS)
-- Index for quick lookup by org + active status
CREATE INDEX idx_webhook_endpoints_org_active
  ON webhook_endpoints (org_id) WHERE is_active = true;

COMMIT;

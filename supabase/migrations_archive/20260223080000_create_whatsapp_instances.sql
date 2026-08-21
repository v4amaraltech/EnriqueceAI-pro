BEGIN;

-- WhatsApp instances for Evolution API (per organization)
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connecting' CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
  phone TEXT,
  qr_base64 TEXT,
  last_error TEXT,
  last_seen_at TIMESTAMPTZ,
  last_status_payload JSONB,
  reconnect_attempts INTEGER NOT NULL DEFAULT 0,
  next_reconnect_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id)
);

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Any org member can view their org's instance
CREATE POLICY "Members can view org whatsapp instance"
  ON whatsapp_instances FOR SELECT
  USING (org_id = public.user_org_id());

-- Only managers can insert/update/delete
CREATE POLICY "Managers can insert whatsapp instance"
  ON whatsapp_instances FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_manager()
  );

CREATE POLICY "Managers can update whatsapp instance"
  ON whatsapp_instances FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.is_manager()
  );

CREATE POLICY "Managers can delete whatsapp instance"
  ON whatsapp_instances FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.is_manager()
  );

-- Provider events for webhook idempotency (Evolution + WhatsApp Meta)
CREATE TABLE IF NOT EXISTS provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);

ALTER TABLE provider_events ENABLE ROW LEVEL SECURITY;

-- Service role only (no RLS policies for regular users)
-- Edge functions use service role to insert/read events

COMMIT;

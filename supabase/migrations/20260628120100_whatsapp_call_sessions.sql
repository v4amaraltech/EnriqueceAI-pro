-- Story 7.2 (Epic 7 — Ligação via WhatsApp): sessões WhatsApp por SDR.
-- Mapeia 1 número WhatsApp <-> 1 SDR <-> sessão do microserviço de voz (WaCalls).
-- Modelo: 1 número dedicado por SDR (distribui risco de ban, mantém identidade).
--
-- phone_number é NULLABLE de propósito: ao criar a sessão (POST /api/sessions) só
-- temos o service_session_id; o número (JID) só é conhecido APÓS o pareamento QR.
--
-- Ref: docs/plans/whatsapp-call-activity-plan.md (§B.2), docs/stories/7.2 e 7.3

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service_session_id TEXT NOT NULL,
  phone_number TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  paired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_whatsapp_call_sessions_status
    CHECK (status IN ('disconnected', 'pairing', 'connected'))
);

COMMENT ON TABLE whatsapp_call_sessions IS
  'Sessão WhatsApp por SDR (1 número dedicado). service_session_id = {sid} no microserviço de voz. Ver epic-7.';
COMMENT ON COLUMN whatsapp_call_sessions.phone_number IS
  'Número pareado (identidade da chamada). NULL enquanto status=pairing — só conhecido após o QR.';

-- Índices: lookup por SDR e por status na org.
CREATE INDEX IF NOT EXISTS idx_whatsapp_call_sessions_org_user
  ON whatsapp_call_sessions(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_call_sessions_org_status
  ON whatsapp_call_sessions(org_id, status);

-- No máximo 1 sessão CONNECTED por SDR (permite histórico de sessões mortas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_call_sessions_active_user
  ON whatsapp_call_sessions(org_id, user_id)
  WHERE status = 'connected';

-- ============================================================================
-- RLS — org-scoped via public.user_org_id(); SDR vê só a sua, manager vê todas.
-- Escrita (pareamento) é manager-only; service_role faz bypass para os workers.
-- ============================================================================
ALTER TABLE whatsapp_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_call_sessions_select" ON whatsapp_call_sessions;
CREATE POLICY "whatsapp_call_sessions_select" ON whatsapp_call_sessions
  FOR SELECT USING (
    org_id = public.user_org_id()
    AND (public.is_manager() OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "whatsapp_call_sessions_insert" ON whatsapp_call_sessions;
CREATE POLICY "whatsapp_call_sessions_insert" ON whatsapp_call_sessions
  FOR INSERT WITH CHECK (
    org_id = public.user_org_id() AND public.is_manager()
  );

DROP POLICY IF EXISTS "whatsapp_call_sessions_update" ON whatsapp_call_sessions;
CREATE POLICY "whatsapp_call_sessions_update" ON whatsapp_call_sessions
  FOR UPDATE USING (
    org_id = public.user_org_id() AND public.is_manager()
  );

DROP POLICY IF EXISTS "whatsapp_call_sessions_delete" ON whatsapp_call_sessions;
CREATE POLICY "whatsapp_call_sessions_delete" ON whatsapp_call_sessions
  FOR DELETE USING (
    org_id = public.user_org_id() AND public.is_manager()
  );

-- updated_at trigger (reusa a função canônica update_updated_at()).
CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_call_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

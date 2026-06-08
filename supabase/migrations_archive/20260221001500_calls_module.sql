-- Story 3.15: Calls Module — tables for call tracking
-- ROLLBACK: See supabase/rollbacks/20260221001500_calls_module_rollback.sql

BEGIN;

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

CREATE TYPE call_status AS ENUM ('significant', 'not_significant', 'no_contact', 'busy', 'not_connected');
CREATE TYPE call_type AS ENUM ('inbound', 'outbound', 'manual');

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- 2.1 Calls
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status call_status NOT NULL DEFAULT 'not_connected',
  type call_type NOT NULL DEFAULT 'outbound',
  cost NUMERIC(10,4),
  recording_url TEXT,
  notes TEXT,
  is_important BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_calls_duration_positive CHECK (duration_seconds >= 0)
);

COMMENT ON TABLE calls IS 'Registro de ligações (inbound, outbound, manual)';
COMMENT ON COLUMN calls.cost IS 'Custo da ligação em BRL (nullable — preenchido por integração VoIP)';
COMMENT ON COLUMN calls.recording_url IS 'URL da gravação (placeholder — integração VoIP futura)';

-- 2.2 Call Feedback
CREATE TABLE call_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE call_feedback IS 'Feedback/anotações sobre ligações feitas por membros da equipe';

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX idx_calls_org_started ON calls(org_id, started_at DESC);
CREATE INDEX idx_calls_org_user ON calls(org_id, user_id);
CREATE INDEX idx_calls_lead ON calls(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_call_feedback_call ON call_feedback(call_id, created_at ASC);

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_feedback ENABLE ROW LEVEL SECURITY;

-- 4.1 Calls — org-scoped using public.user_org_id()
CREATE POLICY "calls_org_read" ON calls
  FOR SELECT USING (org_id = public.user_org_id());

CREATE POLICY "calls_org_insert" ON calls
  FOR INSERT WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "calls_org_update" ON calls
  FOR UPDATE USING (org_id = public.user_org_id());

-- 4.2 Call Feedback — via calls join
CREATE POLICY "call_feedback_org_read" ON call_feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM calls
      WHERE calls.id = call_feedback.call_id
      AND calls.org_id = public.user_org_id()
    )
  );

CREATE POLICY "call_feedback_org_insert" ON call_feedback
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM calls
      WHERE calls.id = call_feedback.call_id
      AND calls.org_id = public.user_org_id()
    )
  );

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- updated_at trigger (reuses existing update_updated_at() function)
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

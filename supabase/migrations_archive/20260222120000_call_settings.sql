-- Call Settings Module — organization-level call configuration
-- ROLLBACK: See supabase/rollbacks/20260222120000_call_settings_rollback.sql

BEGIN;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- 1.1 Organization Call Settings (org-level config)
CREATE TABLE IF NOT EXISTS organization_call_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  calls_enabled BOOLEAN NOT NULL DEFAULT true,
  default_call_type call_type NOT NULL DEFAULT 'outbound',
  significant_threshold_seconds INTEGER NOT NULL DEFAULT 30,
  daily_call_target INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_org_call_settings_org UNIQUE (org_id),
  CONSTRAINT chk_threshold_positive CHECK (significant_threshold_seconds > 0),
  CONSTRAINT chk_daily_target_positive CHECK (daily_call_target >= 0)
);

COMMENT ON TABLE organization_call_settings IS 'Configurações de ligações por organização';
COMMENT ON COLUMN organization_call_settings.significant_threshold_seconds IS 'Duração mínima em segundos para considerar ligação significativa';
COMMENT ON COLUMN organization_call_settings.daily_call_target IS 'Meta diária padrão de ligações da organização';

-- 1.2 Call Daily Targets (per-SDR daily call targets)
CREATE TABLE IF NOT EXISTS call_daily_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  daily_target INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_call_daily_targets_org_user UNIQUE (org_id, user_id),
  CONSTRAINT chk_call_daily_target_positive CHECK (daily_target >= 0)
);

COMMENT ON TABLE call_daily_targets IS 'Meta diária de ligações por vendedor (override org-level)';

-- 1.3 Phone Blacklist (blocked phone patterns)
CREATE TABLE IF NOT EXISTS phone_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_pattern TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_phone_blacklist_org_pattern UNIQUE (org_id, phone_pattern)
);

COMMENT ON TABLE phone_blacklist IS 'Padrões de telefone bloqueados para ligações';

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_org_call_settings_org ON organization_call_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_call_daily_targets_org ON call_daily_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_phone_blacklist_org ON phone_blacklist(org_id);

-- ============================================================================
-- 3. RLS
-- ============================================================================

ALTER TABLE organization_call_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_daily_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_blacklist ENABLE ROW LEVEL SECURITY;

-- 3.1 Organization Call Settings
CREATE POLICY "org_call_settings_select" ON organization_call_settings
  FOR SELECT USING (org_id = public.user_org_id());

CREATE POLICY "org_call_settings_insert" ON organization_call_settings
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "org_call_settings_update" ON organization_call_settings
  FOR UPDATE USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "org_call_settings_delete" ON organization_call_settings
  FOR DELETE USING (org_id = public.user_org_id() AND public.is_manager());

-- 3.2 Call Daily Targets
CREATE POLICY "call_daily_targets_select" ON call_daily_targets
  FOR SELECT USING (org_id = public.user_org_id());

CREATE POLICY "call_daily_targets_insert" ON call_daily_targets
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "call_daily_targets_update" ON call_daily_targets
  FOR UPDATE USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "call_daily_targets_delete" ON call_daily_targets
  FOR DELETE USING (org_id = public.user_org_id() AND public.is_manager());

-- 3.3 Phone Blacklist
CREATE POLICY "phone_blacklist_select" ON phone_blacklist
  FOR SELECT USING (org_id = public.user_org_id());

CREATE POLICY "phone_blacklist_insert" ON phone_blacklist
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "phone_blacklist_update" ON phone_blacklist
  FOR UPDATE USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "phone_blacklist_delete" ON phone_blacklist
  FOR DELETE USING (org_id = public.user_org_id() AND public.is_manager());

-- ============================================================================
-- 4. TRIGGERS
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_call_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON call_daily_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON phone_blacklist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

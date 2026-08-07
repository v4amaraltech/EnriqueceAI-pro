-- Story 3.2: Goals tables for dashboard KPI tracking
-- Tabela goals: metas mensais da organização
-- Tabela goals_per_user: metas individuais por vendedor

-- 1. Goals (organization-level monthly targets)
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  opportunity_target INTEGER NOT NULL DEFAULT 0,
  conversion_target NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE goals IS 'Metas mensais de oportunidades e conversão por organização';
COMMENT ON COLUMN goals.month IS 'Primeiro dia do mês (ex: 2026-02-01)';
COMMENT ON COLUMN goals.opportunity_target IS 'Meta de oportunidades (leads qualificados) no mês';
COMMENT ON COLUMN goals.conversion_target IS 'Meta de taxa de conversão (%) no mês';

-- 2. Goals per user (individual SDR monthly targets)
CREATE TABLE goals_per_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  month DATE NOT NULL,
  opportunity_target INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE goals_per_user IS 'Metas individuais por vendedor/SDR por mês';

-- 3. Unique constraints
CREATE UNIQUE INDEX idx_goals_org_month ON goals(org_id, month);
CREATE UNIQUE INDEX idx_goals_per_user_unique ON goals_per_user(org_id, user_id, month);

-- 4. RLS
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals_per_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goals_org_access" ON goals
  FOR ALL USING (public.user_org_id() = org_id);

CREATE POLICY "goals_per_user_org_access" ON goals_per_user
  FOR ALL USING (public.user_org_id() = org_id);

-- 5. Updated_at trigger (reuse existing pattern)
CREATE TRIGGER set_goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_goals_per_user_updated_at
  BEFORE UPDATE ON goals_per_user
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

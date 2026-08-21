-- ============================================================================
-- Story 3.11: fit_score_rules table
-- ============================================================================
-- Stores scoring rules per org for lead quality evaluation
-- ROLLBACK: DROP TABLE IF EXISTS fit_score_rules;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS fit_score_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  points      INT NOT NULL CHECK (points != 0),
  field       TEXT NOT NULL,
  operator    TEXT NOT NULL CHECK (operator IN ('contains', 'equals', 'not_empty', 'starts_with')),
  value       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fit_score_rules_org ON fit_score_rules(org_id);

COMMENT ON TABLE fit_score_rules IS 'Fit Score rules per org. Each rule adds/subtracts points based on lead field matching.';

-- RLS
ALTER TABLE fit_score_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fit_score_rules_select_own_org"
  ON fit_score_rules FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "fit_score_rules_insert_manager"
  ON fit_score_rules FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "fit_score_rules_update_manager"
  ON fit_score_rules FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "fit_score_rules_delete_manager"
  ON fit_score_rules FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

COMMIT;

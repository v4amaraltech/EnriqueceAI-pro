-- ============================================================================
-- Story 3.8: daily_activity_goals table
-- ============================================================================
-- Stores daily activity targets per user (or org-wide default when user_id IS NULL)
-- ROLLBACK: DROP TABLE IF EXISTS daily_activity_goals;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS daily_activity_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  target      INT NOT NULL DEFAULT 20 CHECK (target >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One goal per user per org (NULL user_id = org default)
CREATE UNIQUE INDEX uq_daily_goal_org_user
  ON daily_activity_goals (org_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'));

COMMENT ON TABLE daily_activity_goals IS 'Daily activity targets. user_id NULL = org-wide default.';

-- updated_at trigger
CREATE TRIGGER set_daily_activity_goals_updated_at
  BEFORE UPDATE ON daily_activity_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE daily_activity_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_goals_org_read" ON daily_activity_goals FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "daily_goals_manager_insert" ON daily_activity_goals FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "daily_goals_manager_update" ON daily_activity_goals FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "daily_goals_manager_delete" ON daily_activity_goals FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

COMMIT;

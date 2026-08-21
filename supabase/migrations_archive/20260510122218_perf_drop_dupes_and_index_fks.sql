-- Performance hygiene round flagged by Supabase's database linter:
--   * 2 duplicate indexes (identical predicate + columns)
--   * 8 foreign keys without a covering index
--   * 1 redundant SELECT-permissive policy on apollo_connections
--
-- Drops are safe because each pair has an identical sibling that stays.
-- New FK indexes are non-concurrent (small tables; lock window is fine).

BEGIN;

-- 1. Drop duplicate indexes
DROP INDEX IF EXISTS public.idx_enrollments_status_due;   -- duplicate of idx_enrollments_active
DROP INDEX IF EXISTS public.idx_interactions_lead_created; -- duplicate of idx_interactions_lead

-- 2. Cover unindexed foreign keys
CREATE INDEX IF NOT EXISTS idx_api4com_connections_user_id        ON public.api4com_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_user_id       ON public.calendar_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_call_daily_targets_user_id         ON public.call_daily_targets (user_id);
CREATE INDEX IF NOT EXISTS idx_calls_user_id                      ON public.calls (user_id);
CREATE INDEX IF NOT EXISTS idx_closer_feedback_requests_closer_id ON public.closer_feedback_requests (closer_id);
CREATE INDEX IF NOT EXISTS idx_gmail_connections_user_id          ON public.gmail_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_per_user_user_id             ON public.goals_per_user (user_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_by                   ON public.leads (created_by);

-- 3. Apollo connections — drop the SELECT-only "members can read" policy and
--    replace the manager ALL policy with separate write-only + universal read
--    policies. This removes the multiple-permissive overlap on SELECT (linter
--    was evaluating two policies per SELECT call) without changing behavior:
--    every member of the org can still read, only managers can write.
DROP POLICY IF EXISTS "managers can manage apollo connections" ON public.apollo_connections;
DROP POLICY IF EXISTS "members can read apollo connections"   ON public.apollo_connections;

CREATE POLICY "members can read apollo connections" ON public.apollo_connections
  FOR SELECT
  USING (org_id = user_org_id());

CREATE POLICY "managers can insert apollo connections" ON public.apollo_connections
  FOR INSERT
  WITH CHECK (org_id = user_org_id() AND is_manager());

CREATE POLICY "managers can update apollo connections" ON public.apollo_connections
  FOR UPDATE
  USING (org_id = user_org_id() AND is_manager())
  WITH CHECK (org_id = user_org_id() AND is_manager());

CREATE POLICY "managers can delete apollo connections" ON public.apollo_connections
  FOR DELETE
  USING (org_id = user_org_id() AND is_manager());

COMMIT;

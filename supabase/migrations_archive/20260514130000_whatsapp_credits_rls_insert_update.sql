-- whatsapp_credits has RLS enabled but only a SELECT policy. Every UPDATE
-- and INSERT from the session-scoped Supabase client (used by Server
-- Actions like execute-activity, execute-scheduled-activity and
-- send-whatsapp-invite) was silently a no-op: PostgREST returns no error
-- when RLS filters out the row, the .update() resolves cleanly, used_credits
-- never increments.
--
-- Evidence: V4 Amaral has 261 real sends in 2026-04 and 506 in 2026-05
-- with used_credits = 0 in both periods. Overage tracking is broken too.
--
-- Fix: add INSERT WITH CHECK and UPDATE USING policies scoped to the
-- user's org. Same authorization rule as the existing SELECT policy.

BEGIN;

CREATE POLICY "wa_credits_org_insert" ON whatsapp_credits FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "wa_credits_org_update" ON whatsapp_credits FOR UPDATE
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

-- Reconcile historical periods: backfill used_credits from interactions
-- so plan limits, overage alerts and the 80% threshold notification
-- reflect reality going forward.
UPDATE whatsapp_credits wc
SET
  used_credits = real.sends,
  overage_count = GREATEST(real.sends - wc.plan_credits, 0)
FROM (
  SELECT
    org_id,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS period,
    COUNT(*)::int AS sends
  FROM interactions
  WHERE channel = 'whatsapp' AND type = 'sent'
  GROUP BY org_id, to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')
) real
WHERE wc.org_id = real.org_id
  AND wc.period = real.period
  AND wc.used_credits = 0
  AND real.sends > 0;

COMMIT;

-- Same shape as the whatsapp_credits fix in 20260514130000: RLS enabled
-- with only a SELECT policy, every UPDATE/INSERT from a session-scoped
-- client (used in Server Actions) is silently dropped by RLS.
--
-- Evidence:
--   - ai_usage: 0 rows org-wide despite months of AI generation. The
--     daily limit check (AIService.checkRateLimit) always sees 0 used,
--     so the limit never enforces and threshold alerts never fire.
--   - enrichment_attempts: 404 rows exist (workers with service role
--     do write), but enrich-lead-apollo Server Action also tries to
--     INSERT via session client — those attempts vanish silently.
--
-- Fix: add INSERT WITH CHECK + UPDATE USING scoped to user's org, same
-- rule as the existing SELECT policies.

BEGIN;

CREATE POLICY "ai_usage_org_insert" ON ai_usage FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "ai_usage_org_update" ON ai_usage FOR UPDATE
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

-- enrichment_attempts has no org_id column — scope via leads.lead_id
CREATE POLICY "enrichment_attempts_org_insert" ON enrichment_attempts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = enrichment_attempts.lead_id
        AND leads.org_id = public.user_org_id()
    )
  );

COMMIT;

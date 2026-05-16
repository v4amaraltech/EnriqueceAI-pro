-- Two quick-win lockdowns flagged by the Supabase security advisor:
--
-- 1. audit_lead_lifecycle_direct_update is a TRIGGER function — it should
--    never be callable via /rest/v1/rpc. Supabase exposes any SECURITY
--    DEFINER function in the public schema as a callable RPC by default;
--    revoke EXECUTE from PUBLIC/anon/authenticated so only the trigger
--    invocation path can reach it.
--
-- 2. api_secrets has RLS enabled but no policies. Default-deny is the
--    safe outcome (anything not allowed is denied) but the advisor
--    flags it as ambiguous. Add an explicit "deny all" stance for
--    anon/authenticated/PUBLIC. service_role bypasses RLS, so the
--    legitimate caller (verify_api_secret SECURITY DEFINER) keeps
--    working.

BEGIN;

-- ── 1. Lockdown the audit trigger function ──────────────────────
REVOKE EXECUTE ON FUNCTION public.audit_lead_lifecycle_direct_update()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_lead_lifecycle_direct_update()
  TO postgres;

-- ── 2. Explicit deny-all on api_secrets ─────────────────────────
-- These policies are defensive (RLS already denies by default with no
-- policies), but the lint complains about the missing policies and a
-- future engineer might add a permissive one without realizing the
-- table holds shared-secret hashes.

CREATE POLICY "api_secrets_deny_anon_select"
  ON public.api_secrets FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE POLICY "api_secrets_deny_anon_modify"
  ON public.api_secrets FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMIT;

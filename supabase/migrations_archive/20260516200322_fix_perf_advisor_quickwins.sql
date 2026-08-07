-- Two performance-advisor quick wins:
--
-- 1. api_secrets had two overlapping permissive policies for SELECT after
--    20260516195119_lockdown_audit_trigger_and_api_secrets:
--      - api_secrets_deny_anon_select (FOR SELECT)
--      - api_secrets_deny_anon_modify (FOR ALL, which covers SELECT)
--    PostgreSQL evaluates both on every SELECT, doubling the policy
--    check cost for no functional gain. Drop the SELECT-only policy.
--
-- 2. idx_leads_search is a GIN(tsvector) index over razao_social/
--    nome_fantasia/cnpj, but the app's lead search uses plain
--    ILIKE '%query%' (see fetch-leads.ts). ILIKE can't use GIN
--    tsvector — the index sits idle while still costing write
--    amplification on every leads INSERT/UPDATE. 440 kB and growing.
--    Drop until somebody wires up a real to_tsvector @@ to_tsquery
--    query in code.

BEGIN;

DROP POLICY IF EXISTS "api_secrets_deny_anon_select" ON public.api_secrets;

DROP INDEX IF EXISTS public.idx_leads_search;

COMMIT;

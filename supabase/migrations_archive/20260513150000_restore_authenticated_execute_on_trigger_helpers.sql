-- Self-inflicted wound: migrations 20260513110000 / 20260513130000 created
-- helper functions used by BEFORE-INSERT/UPDATE triggers on `leads`, then
-- REVOKEd EXECUTE from `authenticated`. The triggers themselves are
-- SECURITY INVOKER, so when a signed-in user runs an INSERT/UPDATE the
-- trigger fires under their role and the function call dies with
-- "permission denied for function <name>".
--
-- Real-world symptom: Rafael's CSV import of 30 leads on 2026-05-13 failed
-- 30/30 rows with "permission denied for function derive_segmento".
--
-- Restore EXECUTE for authenticated. anon stays revoked — these aren't
-- meant to be hit over the REST surface, they're just internal helpers.
-- Also restore for service_role for symmetry, and for `postgres` which is
-- what the backfill ran under (still worked because the role bypasses the
-- grant, but explicit is better than implicit).

BEGIN;

GRANT EXECUTE ON FUNCTION public.derive_segmento(TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derive_segmento_from_cnae(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derive_segmento_from_nome(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extract_website_from_email(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_tier_from_faixa(TEXT) TO authenticated, service_role;

COMMIT;

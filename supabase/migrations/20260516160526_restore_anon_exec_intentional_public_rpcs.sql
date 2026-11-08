-- The blanket anon REVOKE in 20260516160057 over-corrected — two RPCs
-- are intentionally callable by anon to power the v4-sales-frontend
-- public ranking page (originally granted in 20260515212658 /
-- 20260515214303). Restore those two grants. The next migration
-- (20260516161116_protect_public_rpcs_with_shared_secret) replaces
-- this open access with a shared-secret gate.

BEGIN;

DO $$ BEGIN IF to_regprocedure('public.get_leads_for_v4sales(text)') IS NOT NULL THEN
  GRANT EXECUTE ON FUNCTION public.get_leads_for_v4sales(p_from_date text) TO anon;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_indicacoes_ranking(integer, integer)') IS NOT NULL THEN
  GRANT EXECUTE ON FUNCTION public.get_indicacoes_ranking(p_year integer, p_month integer) TO anon;
END IF; END $$;

COMMIT;

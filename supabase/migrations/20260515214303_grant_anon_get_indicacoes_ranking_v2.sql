-- Intentional anon exposure for the upcoming v4-sales-frontend ranking
-- page. Superseded by the shared-secret gate in
-- 20260516161116_protect_public_rpcs_with_shared_secret.

DO $$ BEGIN IF to_regprocedure('public.get_indicacoes_ranking(integer, integer)') IS NOT NULL THEN
  GRANT EXECUTE ON FUNCTION public.get_indicacoes_ranking(integer, integer) TO anon;
END IF; END $$;

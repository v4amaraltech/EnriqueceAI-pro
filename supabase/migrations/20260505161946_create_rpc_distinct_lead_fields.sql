BEGIN;

-- RPCs to retrieve distinct values from leads at the database level.
-- Avoids the PostgREST default row limit, which truncated rare values
-- (e.g. 'Recovery') from the Sub-origem filter on orgs with many leads.
-- SECURITY DEFINER + explicit org scoping via user_org_id() keeps tenant isolation.

CREATE OR REPLACE FUNCTION public.get_distinct_lead_canais()
RETURNS TABLE(canal TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT l.canal
  FROM leads l
  WHERE l.org_id = public.user_org_id()
    AND l.deleted_at IS NULL
    AND l.canal IS NOT NULL
    AND l.canal <> ''
  ORDER BY l.canal;
$$;

COMMENT ON FUNCTION public.get_distinct_lead_canais IS 'Retorna canais distintos dos leads do org do usuário autenticado. Usado pelo filtro Sub-origem.';

CREATE OR REPLACE FUNCTION public.get_distinct_lead_cnaes()
RETURNS TABLE(cnae TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT l.cnae
  FROM leads l
  WHERE l.org_id = public.user_org_id()
    AND l.deleted_at IS NULL
    AND l.cnae IS NOT NULL
    AND l.cnae <> ''
  ORDER BY l.cnae;
$$;

COMMENT ON FUNCTION public.get_distinct_lead_cnaes IS 'Retorna CNAEs distintos dos leads do org do usuário autenticado. Usado pelo filtro CNAE.';

GRANT EXECUTE ON FUNCTION public.get_distinct_lead_canais() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_lead_cnaes() TO authenticated;

COMMIT;

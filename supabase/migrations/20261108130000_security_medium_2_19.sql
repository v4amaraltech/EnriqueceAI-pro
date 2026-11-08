-- Correções de segurança MEDIUM encadeadas (pistas 2 e 19 da auditoria).
-- Idempotente, forward-only.
--
-- Pista 19: worker_run_state tinha SELECT USING (true) para authenticated, e
--   metadata.orgs[].org_id vazava UUIDs de todas as orgs. Todo acesso do app e dos
--   crons usa service_role (que ignora RLS), então a policy e o grant saem.
-- Pista 2: RPCs SECURITY DEFINER do Sales Hub (e-mail de SDR + carga por org)
--   executáveis por anon com qualquer p_org_id.
--   - get_sdr_atividades_atrasadas_v2: sem chamador conhecido (não existe em
--     produção); passa a ser só service_role.
--   - get_sdr_atividades_atrasadas_v4 e get_sdr_leads_para_abrir_v2: o Sales Hub
--     chama com a chave anon pelo navegador, então não dá para revogar de uma vez.
--     Fase 1: ganham p_api_token (DEFAULT NULL). Usuário logado só vê a própria org;
--     token válido vale só para a org do Sales Hub; sem token, anon ainda funciona
--     (transição) e gera WARNING. Fase 2 (futura): remover o ramo sem token depois
--     que o Sales Hub enviar p_api_token.
-- Usa DROP + CREATE com GRANT explícito (CREATE OR REPLACE com outra assinatura
-- criaria sobrecarga e manteria a antiga exposta).

BEGIN;

-- 1. Pista 19 ------------------------------------------------------------------
DROP POLICY IF EXISTS worker_run_state_select_authenticated ON public.worker_run_state;
REVOKE ALL ON public.worker_run_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worker_run_state TO service_role;

-- 2. Pista 2: v2 só service_role ------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_sdr_atividades_atrasadas_v2'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 3. Pista 2: v4 e abrir_v2 com checagem de chamador ---------------------------
DROP FUNCTION IF EXISTS public.get_sdr_atividades_atrasadas_v4(uuid);
DROP FUNCTION IF EXISTS public.get_sdr_atividades_atrasadas_v4(uuid, text);

CREATE FUNCTION public.get_sdr_atividades_atrasadas_v4(
  p_org_id uuid,
  p_api_token text DEFAULT NULL
)
RETURNS TABLE(email text, atrasadas bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    IF p_api_token IS NOT NULL THEN
      -- Token do Sales Hub vale só para a org do Sales Hub.
      IF NOT (p_org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid
              AND public.verify_api_secret('v4sales_public_rpc', p_api_token)) THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;
    ELSIF auth.role() = 'anon' THEN
      -- Transição: Sales Hub ainda chama sem token. Remover na fase 2.
      RAISE WARNING 'get_sdr_atividades_atrasadas_v4 chamada sem token (anon)';
    ELSE
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT u.email::text, count(*)::bigint AS atrasadas
  FROM public.list_overdue_activities_brt(p_org_id, public.overdue_cutoff_brt()) o
  JOIN leads l ON l.id = o.lead_id
  JOIN auth.users u ON u.id = o.assigned_to
  JOIN organization_members m
    ON m.user_id = o.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.deleted_at IS NULL
    AND l.status NOT IN ('won','unqualified','archived')
  GROUP BY u.email
  ORDER BY atrasadas DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sdr_atividades_atrasadas_v4(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sdr_atividades_atrasadas_v4(uuid, text)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_sdr_leads_para_abrir_v2(uuid);
DROP FUNCTION IF EXISTS public.get_sdr_leads_para_abrir_v2(uuid, text);

CREATE FUNCTION public.get_sdr_leads_para_abrir_v2(
  p_org_id uuid,
  p_api_token text DEFAULT NULL
)
RETURNS TABLE(email text, na_fila bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    IF p_api_token IS NOT NULL THEN
      IF NOT (p_org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid
              AND public.verify_api_secret('v4sales_public_rpc', p_api_token)) THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;
    ELSIF auth.role() = 'anon' THEN
      RAISE WARNING 'get_sdr_leads_para_abrir_v2 chamada sem token (anon)';
    ELSE
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT u.email::text, count(*)::bigint AS na_fila
  FROM leads_no_active_enrollment l
  JOIN auth.users u ON u.id = l.assigned_to
  JOIN organization_members m
    ON m.user_id = l.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.status = 'new'
  GROUP BY u.email
  ORDER BY na_fila DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sdr_leads_para_abrir_v2(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sdr_leads_para_abrir_v2(uuid, text)
  TO anon, authenticated, service_role;

COMMIT;

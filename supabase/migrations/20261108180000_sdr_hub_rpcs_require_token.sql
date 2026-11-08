-- Fase 2 da story sales-hub-sdr-rpcs-token (auditoria de segurança, pista 2).
--
-- O que muda: get_sdr_atividades_atrasadas_v4(uuid,text) e
-- get_sdr_leads_para_abrir_v2(uuid,text) deixam de aceitar anon SEM token.
-- A fase 1 (20261108130000_security_medium_2_19.sql) tinha um ramo de transição
--   ELSIF auth.role() = 'anon' THEN RAISE WARNING ...
-- que deixava seguir. Ele sai; o resto do corpo é idêntico ao da fase 1.
--
-- Quem continua passando (sem mudança):
--   - service_role;
--   - usuário logado consultando a própria org (p_org_id = user_org_id());
--   - qualquer chamador com p_api_token válido ('v4sales_public_rpc'), e só para
--     a org do Sales Hub (V4 Amaral). O Sales Hub chama pela Edge Function
--     sdr-enriquece-metrics com a chave anon + token — por isso anon MANTÉM
--     EXECUTE (sem token agora recebe 42501 Forbidden).
--
-- Mesma assinatura → CREATE OR REPLACE (mantém default de p_api_token, tipo de
-- retorno e ACL; DROP + CREATE reconcederia EXECUTE). Grants reafirmados abaixo.
--
-- Verificação pós-merge (depois de aplicar):
--   1. SELECT position('''anon''' in pg_get_functiondef(oid)) FROM pg_proc
--      WHERE proname IN ('get_sdr_atividades_atrasadas_v4','get_sdr_leads_para_abrir_v2');
--      → 0 nas duas; proacl continua {postgres,anon,authenticated,service_role}=X.
--   2. POST /rest/v1/rpc/<função> só com a chave anon, sem p_api_token → 403 (42501).
--   3. Cards do Sales Hub (via Edge Function) continuam com números.
--   4. edge_logs: nenhum 42501 vindo do Sales Hub nas horas seguintes.
--   Abas do Sales Hub abertas antes do deploy do proxy podem ainda chamar a RPC
--   direto sem token: precisam recarregar.
--
-- Rollback: reaplicar as duas funções como estão em
-- 20261108130000_security_medium_2_19.sql (com o ramo anon), usando
-- CREATE OR REPLACE — sem DROP.
--
-- Fora do escopo (mudança separada): get_sdr_leads_abertos(integer,integer)
-- segue SECURITY DEFINER, sem p_api_token e executável por anon (agregados com
-- e-mails). O Hub ainda chama direto; migrar o consumidor e então proteger.
-- RPCs de indicações e get_leads_for_v4sales também não mudam aqui.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sdr_atividades_atrasadas_v4(
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

CREATE OR REPLACE FUNCTION public.get_sdr_leads_para_abrir_v2(
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

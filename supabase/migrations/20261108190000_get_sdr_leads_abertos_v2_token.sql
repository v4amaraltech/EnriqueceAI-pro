-- Caminho protegido para "leads abertos por SDR" do Sales Hub (story
-- sales-hub-sdr-rpcs-token, pendência da fase 2).
--
-- O que faz: cria public.get_sdr_leads_abertos_v2(p_year, p_month, p_api_token).
-- Mesmos cálculos, mesmo JSON, mesmo fuso (America/Sao_Paulo) e mesma org fixa
-- (V4 Amaral) da legada public.get_sdr_leads_abertos(int,int) — que existe só em
-- produção e NÃO é tocada aqui (assinatura, corpo e permissões ficam iguais).
--
-- Quem passa (senão 42501 Forbidden):
--   - service_role;
--   - usuário logado cuja org (public.user_org_id()) é a V4;
--   - quem manda p_api_token válido (verify_api_secret('v4sales_public_rpc', …)).
--     Token NULL, vazio ou errado não autoriza. Por isso anon tem EXECUTE: o proxy
--     servidor do Hub chama com a chave anon + token.
-- Sem parâmetro de org e sem default no token (não há sobrecarga da legada: o
-- nome é outro).
--
-- Única diferença de execução para a legada: v_start/v_end são calculados DEPOIS
-- da checagem, para que um chamador não autorizado receba 42501 e não um erro de
-- data inválida. Para quem está autorizado, o resultado é idêntico.
--
-- ATENÇÃO: este PR cria o caminho protegido, mas NÃO fecha a exposição. A
-- legada continua executável por anon sem token. Ordem dos próximos passos:
--   1. migrar o consumidor do Hub para o proxy autenticado chamando a _v2;
--   2. validar tráfego real (edge_logs: chamadas à _v2 com 200, legada zerando);
--   3. só então bloquear a legada (REVOKE de PUBLIC/anon/authenticated) em PR
--      próprio.
--
-- Verificação pós-merge (depois de aplicar):
--   - SELECT pg_get_function_arguments('public.get_sdr_leads_abertos_v2(integer,integer,text)'::regprocedure)
--     → 'p_year integer, p_month integer, p_api_token text' (sem DEFAULT);
--   - proacl da _v2 = postgres, anon, authenticated, service_role (sem PUBLIC);
--   - md5(pg_get_functiondef) e proacl da legada iguais aos de antes
--     (md5 b899208067dcb769ccca919238c65a6d em 2026-11-08);
--   - como service_role: _v2(ano, mês, NULL) = legada(ano, mês) para o mês atual
--     e o anterior;
--   - POST /rest/v1/rpc/get_sdr_leads_abertos_v2 só com a chave anon e sem token
--     → 403 (42501).
--
-- Rollback (só a função nova; a legada não muda):
--   DROP FUNCTION IF EXISTS public.get_sdr_leads_abertos_v2(integer, integer, text);

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sdr_leads_abertos_v2(
  p_year integer,
  p_month integer,
  p_api_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org   uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_tz    text := 'America/Sao_Paulo';
  v_start timestamptz;
  v_end   timestamptz;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND public.user_org_id() IS DISTINCT FROM v_org
     AND NOT (p_api_token IS NOT NULL
              AND p_api_token <> ''
              AND public.verify_api_secret('v4sales_public_rpc', p_api_token)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_start := (make_date(p_year, p_month, 1)::timestamp) AT TIME ZONE v_tz;
  v_end   := ((make_date(p_year, p_month, 1) + interval '1 month')::timestamp) AT TIME ZONE v_tz;

  WITH ev AS (
    SELECT e.lead_id, e.assigned_to, e.opened_at,
           min(e.opened_at) OVER (PARTITION BY e.lead_id) AS first_ever
    FROM public.leads_opened_events(v_org, NULL) e
  ),
  firsts AS (
    SELECT ev.assigned_to, ev.opened_at AS created_at,
           (ev.opened_at > ev.first_ever) AS is_reabertura
    FROM ev
    JOIN public.organization_members m
      ON m.user_id = ev.assigned_to AND m.org_id = v_org
     AND m.role = 'sdr' AND m.status IN ('active','invited')
    WHERE ev.opened_at >= v_start AND ev.opened_at < v_end
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM firsts),
    'novos', (SELECT count(*) FILTER (WHERE NOT is_reabertura) FROM firsts),
    'reabertos', (SELECT count(*) FILTER (WHERE is_reabertura) FROM firsts),
    'by_email', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', email, 'n', n, 'novos', novos, 'reabertos', reabertos) ORDER BY n DESC)
      FROM (
        SELECT u.email::text AS email, count(*) AS n,
               count(*) FILTER (WHERE NOT f.is_reabertura) AS novos,
               count(*) FILTER (WHERE f.is_reabertura) AS reabertos
        FROM firsts f LEFT JOIN auth.users u ON u.id = f.assigned_to
        GROUP BY u.email
      ) z
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', dia, 'opened', n) ORDER BY dia)
      FROM (
        SELECT (f.created_at AT TIME ZONE v_tz)::date AS dia, count(*) AS n
        FROM firsts f GROUP BY 1
      ) z2
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sdr_leads_abertos_v2(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sdr_leads_abertos_v2(integer, integer, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_sdr_leads_abertos_v2(integer, integer, text) IS
  'Leads abertos por SDR (org V4 fixa, mês em America/Sao_Paulo). Exige service_role, usuário da org V4 ou p_api_token válido (v4sales_public_rpc).';

COMMIT;

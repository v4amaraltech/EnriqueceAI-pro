-- ============================================================================
-- Blindagem das 3 RPCs públicas do Sales Hub
-- Story: docs/stories/security-definer-execute-audit.story.md
-- ============================================================================
--
-- ⚠️  APLICAÇÃO COORDENADA — NÃO aplicar junto com `20260909210000`.
--
-- Estas 3 funções são chamadas hoje pelo Sales Hub (projeto `ejxlbbbjyexsoltsxiqq`)
-- com a anon key, sem token, e respondem 200. Esta migration liga a guarda de
-- shared secret: a partir dela, a chamada sem `p_api_token` passa a receber 403
-- (42501). Só aplicar quando o Sales Hub estiver enviando o token.
--
-- O token já existe e o Sales Hub já o possui: é o mesmo `v4sales_public_rpc`
-- que ele usa em `get_leads_for_v4sales`. Do lado dele, a mudança é acrescentar
-- `p_api_token` ao corpo da requisição.
--
-- O QUE ESTAVA ERRADO
--
--   get_sdr_leads_abertos(p_year, p_month)      org V4 hardcoded, sem guarda
--   get_sdr_atividades_atrasadas_v3(p_org_id)   recebe p_org_id e NÃO valida
--   get_sdr_leads_para_abrir_v2(p_org_id)       recebe p_org_id e NÃO valida
--
-- As três devolvem e-mails de SDRs (de auth.users) e volumetria de operação.
-- As duas que recebem `p_org_id` aceitavam qualquer org: um authenticated de
-- outra org lia a operação alheia trocando o parâmetro.
--
-- POR QUE DROP + CREATE, E NÃO CREATE OR REPLACE
--
-- Acrescentar `p_api_token text DEFAULT NULL` muda a assinatura. CREATE OR
-- REPLACE criaria uma SOBRECARGA e deixaria a função antiga no ar, ainda
-- exposta — exatamente o oposto do objetivo. Por isso DROP + CREATE, e por isso
-- cada bloco termina com REVOKE FROM PUBLIC + GRANT explícito: o DROP descarta a
-- ACL e o CREATE herda o default privilege do schema, que concede a PUBLIC.
-- Foi assim que `20260909184311` reabriu `fetch_inactive_enrollment_candidates`.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- get_sdr_leads_abertos — org V4 fixa, ganha guarda de token
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_sdr_leads_abertos(integer, integer);

CREATE FUNCTION public.get_sdr_leads_abertos(
  p_year      integer,
  p_month     integer,
  p_api_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_org        uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_caller_org uuid := public.user_org_id();
  v_tz         text := 'America/Sao_Paulo';
  v_start      timestamptz := (make_date(p_year, p_month, 1)::timestamp) AT TIME ZONE v_tz;
  v_end        timestamptz := ((make_date(p_year, p_month, 1) + interval '1 month')::timestamp) AT TIME ZONE v_tz;
  v_result     jsonb;
BEGIN
  IF v_caller_org IS DISTINCT FROM v_org
     AND auth.role() <> 'service_role'
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT i.lead_id, l.assigned_to, i.created_at,
           ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = v_org
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
      AND l.status <> 'archived'
      AND l.deleted_at IS NULL
      AND l.assigned_to IS NOT NULL
  ),
  firsts AS (
    SELECT r.assigned_to, r.created_at
    FROM ranked r
    WHERE r.rn = 1
      AND r.created_at >= v_start AND r.created_at < v_end
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM firsts),
    'by_email', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', email, 'n', n) ORDER BY n DESC)
      FROM (
        SELECT u.email::text AS email, count(*) AS n
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

REVOKE EXECUTE ON FUNCTION public.get_sdr_leads_abertos(integer, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sdr_leads_abertos(integer, integer, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_sdr_atividades_atrasadas_v3 — p_org_id passa a ser validado
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_sdr_atividades_atrasadas_v3(uuid);

CREATE FUNCTION public.get_sdr_atividades_atrasadas_v3(
  p_org_id    uuid,
  p_api_token text DEFAULT NULL
)
RETURNS TABLE(email text, atrasadas bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_caller_org uuid := public.user_org_id();
BEGIN
  -- Só passa quem é da própria org, o service_role, ou quem apresenta o token.
  -- O token vale apenas para a org V4 (é o segredo do Sales Hub), então ele não
  -- serve para ler a operação de uma org qualquer.
  IF v_caller_org IS DISTINCT FROM p_org_id
     AND auth.role() <> 'service_role'
     AND NOT (
       p_org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
       AND public.verify_api_secret('v4sales_public_rpc', p_api_token)
     ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.email::text, count(*)::bigint AS atrasadas
  FROM public.list_overdue_activities_brt(p_org_id, now()) o
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

REVOKE EXECUTE ON FUNCTION public.get_sdr_atividades_atrasadas_v3(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sdr_atividades_atrasadas_v3(uuid, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_sdr_leads_para_abrir_v2 — p_org_id passa a ser validado
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_sdr_leads_para_abrir_v2(uuid);

CREATE FUNCTION public.get_sdr_leads_para_abrir_v2(
  p_org_id    uuid,
  p_api_token text DEFAULT NULL
)
RETURNS TABLE(email text, na_fila bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_caller_org uuid := public.user_org_id();
BEGIN
  IF v_caller_org IS DISTINCT FROM p_org_id
     AND auth.role() <> 'service_role'
     AND NOT (
       p_org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
       AND public.verify_api_secret('v4sales_public_rpc', p_api_token)
     ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.email::text, count(*)::bigint AS na_fila
  FROM leads l
  JOIN auth.users u ON u.id = l.assigned_to
  JOIN organization_members m
    ON m.user_id = l.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.status = 'new'
    AND NOT EXISTS (
      SELECT 1 FROM cadence_enrollments ce
      WHERE ce.lead_id = l.id
    )
  GROUP BY u.email
  ORDER BY na_fila DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sdr_leads_para_abrir_v2(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sdr_leads_para_abrir_v2(uuid, text) TO anon, authenticated, service_role;

COMMIT;

-- ============================================================================
-- VERIFICAÇÃO OBRIGATÓRIA — rodar DEPOIS de aplicar:
--
--   1. proacl das 3 funções: só anon, authenticated, service_role e postgres.
--      Nenhum `=X/postgres` (PUBLIC) deve ter voltado.
--   2. Chamada anon SEM token, de fora da org V4 → 403 (42501).
--   3. Chamada anon COM token → 200.
--   4. Sales Hub voltou a carregar as 3 telas.
--
-- Script pronto: scripts/audits/definer-exec-audit.sql
-- ============================================================================

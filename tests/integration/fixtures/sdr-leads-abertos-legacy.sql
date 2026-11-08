-- Complemento de statistics-schema.sql para testar get_sdr_leads_abertos_v2.
-- NÃO é migration.
--
-- Copiado de PROD (dhkmonctyoaenejemkrt) em 2026-11-08, só leitura:
--   public.get_sdr_leads_abertos(int,int) → pg_get_functiondef + proacl
--     (existe só em prod; o teste confere o md5 contra o de prod)
--   public.verify_api_secret(text,text)  → igual à migration 20260516161116
-- auth.users e api_secrets só com as colunas usadas.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

-- ── Segredo compartilhado (sem o seed: o teste grava o hash de um token fictício)
CREATE TABLE public.api_secrets (
  name text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (name, created_at)
);
ALTER TABLE public.api_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_secrets FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.verify_api_secret(p_name text, p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.api_secrets s
    WHERE s.name = p_name
      AND s.revoked_at IS NULL
      AND s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.verify_api_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_secret(text, text) TO service_role;

-- ── RPC legada, como está em prod ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sdr_leads_abertos(p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
DECLARE
  v_org   uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_tz    text := 'America/Sao_Paulo';
  v_start timestamptz := (make_date(p_year, p_month, 1)::timestamp) AT TIME ZONE v_tz;
  v_end   timestamptz := ((make_date(p_year, p_month, 1) + interval '1 month')::timestamp) AT TIME ZONE v_tz;
  v_result jsonb;
BEGIN
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

-- ACL de prod: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
GRANT EXECUTE ON FUNCTION public.get_sdr_leads_abertos(integer, integer)
  TO PUBLIC, anon, authenticated, service_role;

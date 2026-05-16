-- Gate get_leads_for_v4sales and get_indicacoes_ranking behind a shared
-- secret, since they are intentionally callable by `anon` (the
-- v4-sales-frontend public site uses the supabase anon key, which is
-- bundled in any browser bundle). Without this gate, anyone with the
-- public Supabase URL could POST /rest/v1/rpc/get_leads_for_v4sales and
-- download the full V4 Amaral leads base (CNPJ, contact name/email/phone,
-- pipeline status) — LGPD-sensitive.
--
-- Auth model:
--   1. Caller passes p_api_token text — the plain shared secret.
--   2. Function computes encode(extensions.digest(p_api_token, 'sha256'), 'hex').
--   3. Match against api_secrets.token_hash WHERE name = '...' AND revoked_at IS NULL.
--   4. service_role bypasses (auth.role() = 'service_role').
--   5. Org-owner (caller authenticated AND user_org_id() = V4 Amaral) also bypasses.
--
-- Rotation: insert a new row with the next token, then UPDATE the old one
-- with revoked_at = now() once clients are migrated. The plaintext token
-- is never stored — only the SHA-256 hash. The active token for
-- 'v4sales_public_rpc' was generated 2026-05-16 and shared out-of-band
-- with the v4-sales-frontend operator; the seed below is just the hash.

BEGIN;

CREATE TABLE IF NOT EXISTS public.api_secrets (
  name text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (name, created_at)
);

COMMENT ON TABLE public.api_secrets IS
  'Shared secrets for anon-callable RPCs. token_hash = sha256(plain).';

ALTER TABLE public.api_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_secrets FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_secrets TO service_role;

INSERT INTO public.api_secrets (name, token_hash)
VALUES ('v4sales_public_rpc', 'f6d75f2f1b7a38f589a155d43ea0652fe4e92d74be950aebd476c9c912b4f34b')
ON CONFLICT DO NOTHING;

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

DROP FUNCTION IF EXISTS public.get_leads_for_v4sales(text);

CREATE FUNCTION public.get_leads_for_v4sales(
  p_api_token text,
  p_from_date text DEFAULT NULL
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_caller_org uuid := public.user_org_id();
BEGIN
  IF auth.role() <> 'service_role'
     AND v_caller_org IS DISTINCT FROM v_org_id
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT row_to_json(t)
    FROM (
      SELECT
        l.id as enriquece_lead_id,
        l.assigned_to as enriquece_user_id,
        l.cnpj, l.razao_social, l.nome_fantasia, l.porte,
        l.email, l.telefone, l.phones,
        l.first_name, l.last_name, l.job_title,
        l.status, l.lead_source, l.is_inbound, l.canal,
        l.fit_score, l.engagement_score,
        l.enrichment_status, l.enriched_at,
        l.won_at, l.lost_at, (l.won_at IS NOT NULL) as is_won,
        l.meeting_scheduled_at, l.meeting_held_at,
        l.created_at as created_at_enriquece,
        l.updated_at as updated_at_enriquece
      FROM leads l
      WHERE l.org_id = v_org_id
        AND (
          l.created_at             >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.updated_at          >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_scheduled_at>= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_held_at     >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
        )
      ORDER BY GREATEST(l.created_at, l.updated_at) DESC
    ) t;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_leads_for_v4sales(text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_for_v4sales(text, text) TO anon, service_role;

DROP FUNCTION IF EXISTS public.get_indicacoes_ranking(integer, integer);

CREATE FUNCTION public.get_indicacoes_ranking(
  p_year integer,
  p_month integer,
  p_api_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_investidor_field uuid := '82f14cb5-ed2d-4dec-b292-fb7b402fd956';
  v_data_reuniao_field uuid := '6a939a6c-e75b-40c1-9c2e-7cc9c7a6afe0';
  v_caller_org uuid := public.user_org_id();
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND v_caller_org IS DISTINCT FROM v_org_id
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(row_data ORDER BY reunioes_realizadas DESC, indicacoes DESC)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'investidor', investidor,
        'indicacoes', indicacoes,
        'reunioes_marcadas', reunioes_marcadas,
        'reunioes_realizadas', reunioes_realizadas,
        'cnpjs', cnpjs,
        'nomes', nomes
      ) AS row_data,
      reunioes_realizadas,
      indicacoes
    FROM (
      SELECT
        COALESCE(NULLIF(TRIM(custom_field_values->>v_investidor_field::text), ''), '— Sem investidor') AS investidor,
        COUNT(*)::int AS indicacoes,
        COUNT(*) FILTER (
          WHERE meeting_scheduled_at IS NOT NULL
             OR (
               custom_field_values->>v_data_reuniao_field::text IS NOT NULL
               AND TRIM(custom_field_values->>v_data_reuniao_field::text) NOT IN ('', '.')
             )
        )::int AS reunioes_marcadas,
        COUNT(*) FILTER (WHERE won_at IS NOT NULL)::int AS reunioes_realizadas,
        COALESCE(array_agg(cnpj) FILTER (WHERE cnpj IS NOT NULL AND cnpj <> ''), '{}'::text[]) AS cnpjs,
        COALESCE(
          array_agg(LOWER(TRIM(COALESCE(nome_fantasia, razao_social))))
          FILTER (WHERE COALESCE(nome_fantasia, razao_social) IS NOT NULL
                  AND TRIM(COALESCE(nome_fantasia, razao_social)) <> ''),
          '{}'::text[]
        ) AS nomes
      FROM leads
      WHERE org_id = v_org_id
        AND canal = 'Indicação'
        AND created_at >= make_date(p_year, p_month, 1)
        AND created_at < make_date(p_year, p_month, 1) + interval '1 month'
        AND deleted_at IS NULL
      GROUP BY 1
    ) agg
  ) sorted;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_indicacoes_ranking(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_indicacoes_ranking(integer, integer, text) TO anon, authenticated, service_role;

COMMIT;

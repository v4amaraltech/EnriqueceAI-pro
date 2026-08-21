BEGIN;

-- NOTA DE RECONCILIAÇÃO (2026-05-30): esta migration foi aplicada diretamente
-- em produção em 2026-05-27 (hotfix de advisor) e trazida ao repositório
-- retroativamente para sincronizar o histórico versionado. Conteúdo idêntico
-- ao registrado em supabase_migrations.schema_migrations.

-- Corrige bug: anon bypass na verificação de token de get_indicacoes_ranking.
-- A condição anterior "v_caller_org IS NOT NULL" era FALSE para anon (org = NULL),
-- fazendo toda a checagem ser ignorada. Qualquer chamada anon passava sem token.
CREATE OR REPLACE FUNCTION public.get_indicacoes_ranking(
  p_year      integer,
  p_month     integer,
  p_api_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_org_id             UUID := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_investidor_field   UUID := '82f14cb5-ed2d-4dec-b292-fb7b402fd956';
  v_data_reuniao_field UUID := '6a939a6c-e75b-40c1-9c2e-7cc9c7a6afe0';
  v_caller_org         UUID := public.user_org_id();
  v_result             JSONB;
BEGIN
  -- Antes: "v_caller_org IS NOT NULL AND ..." → anon (NULL) pulava toda a checagem.
  -- Agora: alinhado com get_leads_for_v4sales — cobre anon corretamente.
  IF v_caller_org IS DISTINCT FROM v_org_id
     AND auth.role() <> 'service_role'
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(row_data ORDER BY reunioes_realizadas DESC, indicacoes DESC)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'investidor',          investidor,
        'indicacoes',          indicacoes,
        'reunioes_marcadas',   reunioes_marcadas,
        'reunioes_realizadas', reunioes_realizadas,
        'cnpjs',               cnpjs,
        'nomes',               nomes
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
        AND created_at <  make_date(p_year, p_month, 1) + interval '1 month'
        AND deleted_at IS NULL
      GROUP BY 1
    ) agg
  ) sorted;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMIT;

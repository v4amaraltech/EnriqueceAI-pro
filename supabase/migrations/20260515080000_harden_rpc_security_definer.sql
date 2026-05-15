-- Six SECURITY DEFINER RPC functions were callable by `authenticated` (or
-- `anon`) without validating that the caller belongs to the org they
-- query. Supabase advisor flagged them. Net effect: any logged-in user
-- in any org could count leads/activities/conversions of any other org
-- by passing a different p_org_id.
--
-- Two functions (get_indicacoes_ranking, get_sdr_monthly_metrics) had
-- the org_id hardcoded to V4 Company Amaral, so they leaked V4 Amaral's
-- pipeline data to every authenticated user on the platform — and
-- get_indicacoes_ranking was also reachable by `anon` via /rest/v1/rpc.
--
-- Fix: prepend an org check to each function body. Re-create with the
-- exact same signature so PostgREST exposes identical interface.

BEGIN;

-- 1. count_activities_by_performer: org passed as parameter
CREATE OR REPLACE FUNCTION public.count_activities_by_performer(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, cnt bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    i.performed_by as performer_id,
    count(*) as cnt
  FROM interactions i
  WHERE i.org_id = p_org_id
    AND i.type = 'sent'
    AND i.channel NOT IN ('system', 'calendar')
    AND i.created_at >= p_start
    AND i.created_at < p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
    AND i.performed_by IS NOT NULL
  GROUP BY i.performed_by;
END;
$function$;

-- 2. count_leads_by_status
CREATE OR REPLACE FUNCTION public.count_leads_by_status(p_org_id uuid)
RETURNS TABLE(status text, cnt bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.status::text, count(*) as cnt
  FROM leads l
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
  GROUP BY l.status;
END;
$function$;

-- 3. fetch_conversion_ranking_data
CREATE OR REPLACE FUNCTION public.fetch_conversion_ranking_data(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(lead_id uuid, status text, assigned_to uuid, won_by uuid, won_in_period boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    l.id AS lead_id,
    l.status::text,
    l.assigned_to,
    l.won_by,
    (l.status = 'won' AND l.won_at IS NOT NULL AND l.won_at >= p_start AND l.won_at < p_end) AS won_in_period
  FROM leads l
  INNER JOIN cadence_enrollments ce ON ce.lead_id = l.id
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND ce.enrolled_at >= p_start
    AND ce.enrolled_at < p_end;
END;
$function$;

-- 4. leads_without_active_enrollment
CREATE OR REPLACE FUNCTION public.leads_without_active_enrollment(p_org_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id FROM leads l
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM cadence_enrollments ce
      WHERE ce.lead_id = l.id
        AND ce.status IN ('active', 'paused')
    );
END;
$function$;

-- 5. get_executed_steps: scope by caller org since no p_org_id parameter
CREATE OR REPLACE FUNCTION public.get_executed_steps(
  p_cadence_ids uuid[],
  p_step_ids uuid[],
  p_lead_ids uuid[]
)
RETURNS TABLE(cadence_id uuid, step_id uuid, lead_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.cadence_id, i.step_id, i.lead_id
  FROM interactions i
  WHERE i.org_id = public.user_org_id()
    AND i.cadence_id = ANY(p_cadence_ids)
    AND i.step_id = ANY(p_step_ids)
    AND i.lead_id = ANY(p_lead_ids)
    AND i.step_id IS NOT NULL;
END;
$function$;

-- 6. get_indicacoes_ranking: hardcoded V4 Amaral org — restrict to its members
CREATE OR REPLACE FUNCTION public.get_indicacoes_ranking(p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_org_id UUID := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_investidor_field UUID := '82f14cb5-ed2d-4dec-b292-fb7b402fd956';
  v_data_reuniao_field UUID := '6a939a6c-e75b-40c1-9c2e-7cc9c7a6afe0';
  v_result JSONB;
BEGIN
  IF public.user_org_id() IS DISTINCT FROM v_org_id THEN
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

-- get_indicacoes_ranking was exposed to anon — revoke
REVOKE EXECUTE ON FUNCTION public.get_indicacoes_ranking(integer, integer) FROM anon;

-- 7. get_sdr_monthly_metrics: hardcoded V4 Amaral org
CREATE OR REPLACE FUNCTION public.get_sdr_monthly_metrics()
RETURNS TABLE(
  enriquece_user_id uuid,
  leads_abertos bigint,
  ligacoes_realizadas bigint,
  ligacoes_conectadas bigint,
  pct_conectadas numeric,
  reunioes_marcadas bigint,
  reunioes_realizadas bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
    v_now_brt date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_start timestamptz := (DATE_TRUNC('month', v_now_brt)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_end timestamptz := ((DATE_TRUNC('month', v_now_brt) + INTERVAL '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
BEGIN
    IF public.user_org_id() IS DISTINCT FROM v_org_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH la AS (
        SELECT l.assigned_to AS uid, COUNT(*) AS val
        FROM leads l
        WHERE l.org_id = v_org_id
          AND l.assigned_to IS NOT NULL
          AND l.created_at >= v_start AND l.created_at < v_end
        GROUP BY l.assigned_to
    ),
    rm AS (
        SELECT i.performed_by AS uid, COUNT(*) AS val
        FROM interactions i
        WHERE i.type = 'meeting_scheduled'
          AND i.created_at >= v_start AND i.created_at < v_end
          AND i.performed_by IS NOT NULL
        GROUP BY i.performed_by
    ),
    rr AS (
        SELECT l.assigned_to AS uid, COUNT(*) AS val
        FROM leads l
        WHERE l.org_id = v_org_id
          AND l.meeting_held_at >= v_start AND l.meeting_held_at < v_end
          AND l.assigned_to IS NOT NULL
        GROUP BY l.assigned_to
    ),
    li AS (
        SELECT c.user_id AS uid,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE c.status = 'significant') AS connected
        FROM calls c
        WHERE c.started_at >= v_start AND c.started_at < v_end
          AND c.org_id = v_org_id
        GROUP BY c.user_id
    )
    SELECT
        COALESCE(la.uid, rm.uid, rr.uid, li.uid) AS enriquece_user_id,
        COALESCE(la.val, 0) AS leads_abertos,
        COALESCE(li.total, 0) AS ligacoes_realizadas,
        COALESCE(li.connected, 0) AS ligacoes_conectadas,
        CASE WHEN COALESCE(li.total, 0) > 0
            THEN ROUND(COALESCE(li.connected, 0)::numeric / li.total, 4)
            ELSE 0 END AS pct_conectadas,
        COALESCE(rm.val, 0) AS reunioes_marcadas,
        COALESCE(rr.val, 0) AS reunioes_realizadas
    FROM la
    FULL OUTER JOIN rm ON rm.uid = la.uid
    FULL OUTER JOIN rr ON rr.uid = COALESCE(la.uid, rm.uid)
    FULL OUTER JOIN li ON li.uid = COALESCE(la.uid, rm.uid, rr.uid)
    WHERE COALESCE(la.uid, rm.uid, rr.uid, li.uid) IS NOT NULL;
END;
$function$;

COMMIT;

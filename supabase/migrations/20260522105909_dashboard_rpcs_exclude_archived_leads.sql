-- Dashboard metrics now exclude `leads.status = 'archived'`. Archived leads
-- represent discarded prospects (manager moved them out of play) and were
-- previously inflating "lost" buckets, response-time denominators and the
-- leads-opened first-touch count. Applied 2026-05-22 by Dara at user request.
--
-- Affected RPCs (all SECURITY DEFINER, signatures unchanged):
--   - count_activities_by_performer
--   - fetch_conversion_ranking_data
--   - count_leads_opened_by_sdr
--   - count_leads_opened_by_sdr_daily
--
-- Direct PostgREST queries in the dashboard codebase were also patched in the
-- same commit (insights-metrics, get-response-time, ranking-metrics).

BEGIN;

CREATE OR REPLACE FUNCTION public.count_activities_by_performer(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.performed_by, count(*)::bigint
  FROM interactions i
  LEFT JOIN leads l ON l.id = i.lead_id
  WHERE i.org_id = p_org_id
    AND i.type = 'sent'
    AND i.channel NOT IN ('system', 'calendar')
    AND i.created_at >= p_start
    AND i.created_at <  p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
    AND i.performed_by IS NOT NULL
    AND (l.id IS NULL OR l.status <> 'archived')
  GROUP BY i.performed_by;
END;
$$;

CREATE OR REPLACE FUNCTION public.fetch_conversion_ranking_data(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz
)
RETURNS TABLE(lead_id uuid, status text, assigned_to uuid, won_by uuid, won_in_period boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT l.id, l.status::text, l.assigned_to, l.won_by,
    (l.status = 'won' AND l.won_at IS NOT NULL AND l.won_at >= p_start AND l.won_at < p_end)
  FROM leads l
  INNER JOIN cadence_enrollments ce ON ce.lead_id = l.id
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
    AND l.status <> 'archived'
    AND ce.enrolled_at >= p_start AND ce.enrolled_at < p_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id, i.performed_by, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND i.performed_by IS NOT NULL
      AND l.status <> 'archived'
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.performed_by, count(*)::bigint
  FROM ranked r
  WHERE r.rn = 1 AND r.created_at >= p_start AND r.created_at < p_end
  GROUP BY r.performed_by;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr_daily(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, opened_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id, i.performed_by, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND i.performed_by IS NOT NULL
      AND l.status <> 'archived'
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.performed_by, r.created_at
  FROM ranked r
  WHERE r.rn = 1 AND r.created_at >= p_start AND r.created_at < p_end;
END;
$$;

COMMIT;

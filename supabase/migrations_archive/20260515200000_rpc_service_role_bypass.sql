-- The RPC org-check added in 20260515080000 broke the dashboard's
-- "Atividades Realizadas" and "Taxa de Conversão" cards. Those use
-- get-ranking-data which runs server-side via createServiceRoleClient
-- (auth.uid() = NULL → user_org_id() = NULL → IS DISTINCT FROM any
-- real org evaluates true → RAISE EXCEPTION). Result: cards rendered
-- with 0 / 0%.
--
-- Fix: allow auth.role() = 'service_role' to bypass the caller-org
-- check. Cross-tenant isolation is still preserved for authenticated
-- callers (the original threat model), and service-role callers are
-- internal server code we already trust — they query with a real
-- p_org_id from the user's session, and the function body still
-- filters by .eq('org_id', p_org_id) so it doesn't leak across orgs
-- even if the caller-org check is skipped.

BEGIN;

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
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.performed_by, count(*)
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

CREATE OR REPLACE FUNCTION public.count_leads_by_status(p_org_id uuid)
RETURNS TABLE(status text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.status::text, count(*) FROM leads l
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
  GROUP BY l.status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fetch_conversion_ranking_data(
  p_org_id uuid, p_start timestamptz, p_end timestamptz
)
RETURNS TABLE(lead_id uuid, status text, assigned_to uuid, won_by uuid, won_in_period boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    AND ce.enrolled_at >= p_start AND ce.enrolled_at < p_end;
END;
$function$;

CREATE OR REPLACE FUNCTION public.leads_without_active_enrollment(p_org_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id FROM leads l
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM cadence_enrollments ce
      WHERE ce.lead_id = l.id AND ce.status IN ('active', 'paused')
    );
END;
$function$;

COMMIT;

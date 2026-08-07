BEGIN;

-- Fix: dashboard "Taxa de Conversão" SDR ranking was returning 0% for every
-- SDR because the function still keyed off the legacy contract where a
-- finished sale carried status='qualified'. After the won status migration
-- (20260420...), finished sales live under status='won' and the old check
-- silently excluded all of them, making the numerator always zero.

CREATE OR REPLACE FUNCTION public.fetch_conversion_ranking_data(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  lead_id uuid,
  status text,
  assigned_to uuid,
  won_by uuid,
  won_in_period boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
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

COMMIT;

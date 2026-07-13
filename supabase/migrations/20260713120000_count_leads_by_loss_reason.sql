-- Count leads grouped by loss_reason_id, for the "Motivo de Perda" filter on the
-- Leads page. Mirrors count_leads_by_status: STABLE SECURITY DEFINER with an
-- org-scope guard so an SDR can only read counts for their own org.
--
-- The count matches exactly what the filter returns (leads with a loss_reason_id
-- set, excluding soft-deleted). It is NOT gated on status='unqualified' so the
-- number stays consistent with the filtered list, which also filters purely by
-- loss_reason_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.count_leads_by_loss_reason(p_org_id uuid)
  RETURNS TABLE(loss_reason_id uuid, cnt bigint)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.loss_reason_id, count(*)
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.loss_reason_id IS NOT NULL
  GROUP BY l.loss_reason_id;
END;
$function$;

COMMIT;

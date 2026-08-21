-- "Leads Abertos" dashboard card — definition agreed with Vinicius on 2026-05-22:
-- a lead is "opened" the first time an SDR performs a HUMAN-channel interaction
-- on it (phone/whatsapp/email/linkedin/research, type sent or delivered). Other
-- definitions (status=contacted, enrolled in cadence) under- or over-count and
-- depend on manual classification.
--
-- Migration adds (1) a per-month org-level target column and (2) a SECURITY
-- DEFINER RPC that mirrors count_activities_by_performer so the dashboard
-- service layer can reuse the same shape.

BEGIN;

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS leads_opened_target integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, cnt bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id,
      i.performed_by,
      i.created_at,
      i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND i.performed_by IS NOT NULL
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.performed_by, count(*)::bigint
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start
    AND r.created_at <  p_end
  GROUP BY r.performed_by;
END;
$$;

REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr(uuid, timestamptz, timestamptz, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_leads_opened_by_sdr(uuid, timestamptz, timestamptz, uuid[]) TO authenticated, service_role;

-- Same first-touch slice but returns one row per opened lead with timestamp,
-- so the daily cumulative chart on the card can bucket by day client-side.
CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr_daily(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, opened_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id,
      i.performed_by,
      i.created_at,
      i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND i.performed_by IS NOT NULL
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.performed_by, r.created_at
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start
    AND r.created_at <  p_end;
END;
$$;

REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr_daily(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr_daily(uuid, timestamptz, timestamptz, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_leads_opened_by_sdr_daily(uuid, timestamptz, timestamptz, uuid[]) TO authenticated, service_role;

COMMIT;

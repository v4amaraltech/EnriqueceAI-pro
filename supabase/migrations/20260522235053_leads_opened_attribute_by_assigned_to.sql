-- Fix Hit Rate inconsistente — numerador usava leads.assigned_to (SDR
-- responsável) e denominador usava interactions.performed_by (quem fez a
-- interação). Reportado pelo Vinicius 2026-05-22: card Hit Rate mostrava
-- Ismael 26% (43/167) quando o número correto pela atribuição combinada
-- é Ismael 24% (43/176).
--
-- Mudança: count_leads_opened_by_sdr e count_leads_opened_by_sdr_daily
-- agora agrupam por leads.assigned_to em vez de interactions.performed_by.
-- Também removido o filtro `performed_by IS NOT NULL` porque a atribuição
-- agora não depende de quem fez a interação — só do dono do lead. Webhook
-- API4COM externo (sem performed_by) deixa de cair fora do count.
--
-- Filtro `assigned_to IS NOT NULL` adicionado pra evitar leads órfãos
-- inflarem com NULL key.

BEGIN;

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
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.assigned_to, count(*)::bigint
  FROM ranked r
  WHERE r.rn = 1 AND r.created_at >= p_start AND r.created_at < p_end
  GROUP BY r.assigned_to;
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
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
      AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
  )
  SELECT r.assigned_to, r.created_at
  FROM ranked r
  WHERE r.rn = 1 AND r.created_at >= p_start AND r.created_at < p_end;
END;
$$;

COMMIT;

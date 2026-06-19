-- Coluna canônica: data/hora REAL da reunião agendada (o instante em que ela
-- ocorre), distinta de meeting_scheduled_at, que guarda QUANDO o SDR marcou
-- (booking). A hora real da reunião vivia só no metadata.start_time da interação
-- meeting_scheduled (wall-clock America/Sao_Paulo, ex.: "2026-06-19T16:00:00").
--
-- Motivação: o Sales Hub (v4-sales-hub) consome get_leads_for_v4sales e usava
-- meeting_scheduled_at (booking) como se fosse a hora da reunião → toda reunião
-- marcada há +24h e não realizada caía como "No-show", e nenhuma reunião futura
-- aparecia como "Agendada". Esta coluna expõe a hora real pro sync carregar.
--
-- Mantida automaticamente pelo trigger sync_meeting_starts_at em interactions
-- (cobre agendar, reagendar e cancelar — todos os caminhos, sem depender do app).

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meeting_starts_at timestamptz;

COMMENT ON COLUMN public.leads.meeting_starts_at IS
  'Data/hora real da reunião agendada (instante), derivada do metadata.start_time '
  '(wall-clock America/Sao_Paulo) da última interação meeting_scheduled. Distinta de '
  'meeting_scheduled_at (= quando o SDR marcou). Mantida pelo trigger sync_meeting_starts_at.';

-- Recomputa leads.meeting_starts_at a partir da ÚLTIMA interação meeting_scheduled
-- do lead (ou NULL se não houver nenhuma com start_time válido).
CREATE OR REPLACE FUNCTION public.sync_lead_meeting_starts_at(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_starts_at timestamptz;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (i.metadata->>'start_time')::timestamp AT TIME ZONE 'America/Sao_Paulo'
    INTO v_starts_at
  FROM public.interactions i
  WHERE i.lead_id = p_lead_id
    AND i.type = 'meeting_scheduled'
    AND i.metadata->>'start_time' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
  ORDER BY i.created_at DESC
  LIMIT 1;

  UPDATE public.leads
  SET meeting_starts_at = v_starts_at
  WHERE id = p_lead_id
    AND meeting_starts_at IS DISTINCT FROM v_starts_at;
END;
$function$;

-- Trigger: qualquer escrita numa interação meeting_scheduled resincroniza o lead.
CREATE OR REPLACE FUNCTION public.trg_meeting_starts_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'meeting_scheduled' THEN
      PERFORM public.sync_lead_meeting_starts_at(OLD.lead_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.type = 'meeting_scheduled' THEN
    PERFORM public.sync_lead_meeting_starts_at(NEW.lead_id);
  END IF;

  -- UPDATE que move a interação para outro lead: resincroniza o lead antigo também.
  IF TG_OP = 'UPDATE'
     AND OLD.type = 'meeting_scheduled'
     AND OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
    PERFORM public.sync_lead_meeting_starts_at(OLD.lead_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_meeting_starts_at ON public.interactions;
CREATE TRIGGER sync_meeting_starts_at
  AFTER INSERT OR UPDATE OR DELETE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_meeting_starts_at();

-- Backfill (set-based): última meeting_scheduled por lead.
UPDATE public.leads l
SET meeting_starts_at = sub.starts_at
FROM (
  SELECT DISTINCT ON (i.lead_id)
         i.lead_id,
         (i.metadata->>'start_time')::timestamp AT TIME ZONE 'America/Sao_Paulo' AS starts_at
  FROM public.interactions i
  WHERE i.type = 'meeting_scheduled'
    AND i.metadata->>'start_time' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
  ORDER BY i.lead_id, i.created_at DESC
) sub
WHERE l.id = sub.lead_id
  AND l.meeting_starts_at IS DISTINCT FROM sub.starts_at;

-- Expõe meeting_starts_at no payload consumido pelo Sales Hub (n8n → upsert_leads_pv).
CREATE OR REPLACE FUNCTION public.get_leads_for_v4sales(p_api_token text, p_from_date text DEFAULT NULL::text)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
        l.meeting_starts_at,
        l.contacted_at,
        l.created_at as created_at_enriquece,
        l.updated_at as updated_at_enriquece,
        l.deleted_at
      FROM leads l
      WHERE l.org_id = v_org_id
        AND (
          l.created_at             >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.updated_at          >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_scheduled_at>= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_held_at     >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.contacted_at        >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
        )
      ORDER BY GREATEST(l.created_at, l.updated_at) DESC
    ) t;
END;
$function$;

COMMIT;

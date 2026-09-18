-- No-show explícito: o Sales Hub parava de adivinhar pelo relógio.
--
-- Bug: o SDR clica "Reunião não aconteceu" (markMeetingNoShow) e o closer responde
-- no_show no link de feedback, mas nenhum dos dois grava nada consultável no lead —
-- só um evento em `interactions`. get_leads_for_v4sales não expõe esse evento, então
-- o Sales Hub cai numa heurística de tempo em SdrReunioesTable.deriveStatus:
-- reunião passada há <48h = "Pendente", >=48h = "No-show". Resultado: no-show
-- registrado na hora só aparece 2 dias depois, e some de novo se o closer demora.
-- Caso real: Tech Composites (f9c27c4a), reunião 17/09 16:00, no-show marcado
-- 16:35, exibido "Pendente" em 18/09.
--
-- Fix: coluna canônica `meeting_no_show_at` em leads, alimentada pelos dois
-- caminhos (SDR e closer) e propagada na RPC. Sem isso, 71 no-shows históricos
-- (44 do SDR + 27 do closer) são invisíveis pro Sales Hub.

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meeting_no_show_at timestamptz;

COMMENT ON COLUMN public.leads.meeting_no_show_at IS
  'Quando a reunião foi registrada como não realizada (no-show), pelo SDR '
  '(markMeetingNoShow) ou pelo closer (feedback result=no_show). Limpo na '
  'remarcação (sync_lead_meeting_starts_at) e quando a reunião é dada como '
  'realizada. Fonte canônica do status No-show no Sales Hub.';

-- Só interessa a reuniões em aberto: consulta sempre filtra junto de
-- meeting_held_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_leads_meeting_no_show_at
  ON public.leads (meeting_no_show_at)
  WHERE meeting_no_show_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill a partir da timeline.
--
-- Vale o último evento de no-show (SDR ou closer) registrado DEPOIS da hora da
-- reunião que está marcada agora. Um no-show seguido de remarcação não conta: a
-- reunião voltou a estar em jogo. Leads já realizados ficam de fora.
--
-- O corte é contra meeting_starts_at, e não contra o created_at da interaction
-- de agendamento: updateMeeting REMARCA fazendo UPDATE na interaction existente,
-- então created_at continua o da marcação original e não serve de referência.
-- ---------------------------------------------------------------------------
WITH ultimo_no_show AS (
  SELECT i.lead_id, MAX(i.created_at) AS no_show_at
  FROM public.interactions i
  WHERE i.metadata->>'system_event' IN ('meeting_no_show_manual', 'meeting_unconfirmed')
  GROUP BY i.lead_id
)
UPDATE public.leads l
SET meeting_no_show_at = n.no_show_at
FROM ultimo_no_show n
WHERE l.id = n.lead_id
  AND l.meeting_held_at IS NULL
  AND l.meeting_no_show_at IS NULL
  AND (l.meeting_starts_at IS NULL OR n.no_show_at >= l.meeting_starts_at);

-- ---------------------------------------------------------------------------
-- Remarcação limpa o no-show: o carimbo pertence ao evento antigo.
-- ---------------------------------------------------------------------------
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

  -- Mudou a hora da reunião => remarcação => o no-show anterior não vale mais.
  UPDATE public.leads
  SET meeting_starts_at = v_starts_at,
      meeting_no_show_at = NULL
  WHERE id = p_lead_id
    AND meeting_starts_at IS DISTINCT FROM v_starts_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- RPC do Sales Hub propaga o campo novo.
-- ---------------------------------------------------------------------------
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
        l.meeting_no_show_at,
        EXISTS (SELECT 1 FROM closer_feedback_requests c WHERE c.lead_id = l.id) as tem_feedback_closer,
        (SELECT COALESCE(
                  c.decisor_presente,
                  CASE
                    WHEN c.qualificacao_aderente IN ('bateu', 'divergiu')
                      THEN NOT ('decisor' = ANY(COALESCE(c.divergencias, ARRAY[]::text[])))
                    ELSE NULL
                  END
                )
           FROM closer_feedback_requests c
          WHERE c.lead_id = l.id
            AND c.result = 'meeting_done'
            AND (
              c.decisor_presente IS NOT NULL
              OR c.qualificacao_aderente IN ('bateu', 'divergiu')
            )
          ORDER BY c.responded_at DESC NULLS LAST
          LIMIT 1) as decisor_presente,
        -- SAO: aceite comercial do closer (true/false); NULL = ainda sem resposta
        -- ou reunião anterior à pergunta. Sem fallback — não existe proxy p/ SAO.
        (SELECT c.oportunidade_qualificada
           FROM closer_feedback_requests c
          WHERE c.lead_id = l.id
            AND c.result = 'meeting_done'
            AND c.oportunidade_qualificada IS NOT NULL
          ORDER BY c.responded_at DESC NULLS LAST
          LIMIT 1) as oportunidade_qualificada,
        l.contacted_at,
        ft.first_touch_at,
        l.created_at as created_at_enriquece,
        l.updated_at as updated_at_enriquece,
        l.deleted_at
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT MIN(i.created_at) AS first_touch_at
        FROM interactions i
        WHERE i.lead_id = l.id
          AND i.type IN ('sent', 'delivered')
          AND i.channel IN ('phone','whatsapp','email','linkedin','research')
          AND coalesce(i.metadata->>'is_note', '') <> 'true'
      ) ft ON true
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

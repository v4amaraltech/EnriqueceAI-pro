-- Cockpit do SDR (story sdr-cockpit): etapa calculada do lead para a aba
-- "Meus Leads" — cards de carteira (contagem) e coluna Etapa (por lead).
-- Fonte única da regra: as duas funções usam `cockpit_lead_stages`.
--
-- Prioridade (de cima para baixo):
--   sal            reunião realizada (meeting_held_at ou won_at)
--   no_show        meeting_no_show_at
--   sql            reunião agendada (meeting_scheduled_at)
--   desqualificado status unqualified/archived ou lost_at
--   conexao        ligação conectada (mesma regra de features/calls/connection.ts:
--                  não-voicemail, answered_at e >= 50s) ou resposta registrada
--   tentativa      status contacted
--   entrada        o resto (status new)
--
-- SECURITY INVOKER: o RLS de leads/calls/interactions continua valendo.

BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_lead_stages(p_user_id uuid, p_lead_ids uuid[] DEFAULT NULL)
RETURNS TABLE (lead_id uuid, stage text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
  SELECT
    l.id AS lead_id,
    CASE
      WHEN l.meeting_held_at IS NOT NULL OR l.won_at IS NOT NULL THEN 'sal'
      WHEN l.meeting_no_show_at IS NOT NULL THEN 'no_show'
      WHEN l.meeting_scheduled_at IS NOT NULL THEN 'sql'
      WHEN l.status IN ('unqualified', 'archived') OR l.lost_at IS NOT NULL THEN 'desqualificado'
      WHEN EXISTS (
        SELECT 1 FROM public.interactions i
        WHERE i.lead_id = l.id AND i.type = 'replied'
      ) OR EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.lead_id = l.id
          AND c.answered_at IS NOT NULL
          AND c.duration_seconds >= 50
          AND c.sdr_disposition IS DISTINCT FROM 'voicemail'
      ) THEN 'conexao'
      WHEN l.status = 'contacted' THEN 'tentativa'
      ELSE 'entrada'
    END AS stage
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.deleted_at IS NULL
    AND (p_lead_ids IS NULL OR l.id = ANY (p_lead_ids));
$$;

CREATE OR REPLACE FUNCTION public.count_cockpit_lead_stages(p_user_id uuid)
RETURNS TABLE (stage text, total bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
  SELECT s.stage, count(*)::bigint
  FROM public.cockpit_lead_stages(p_user_id) s
  GROUP BY s.stage;
$$;

REVOKE EXECUTE ON FUNCTION public.cockpit_lead_stages(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_cockpit_lead_stages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_lead_stages(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_cockpit_lead_stages(uuid) TO authenticated;

COMMIT;

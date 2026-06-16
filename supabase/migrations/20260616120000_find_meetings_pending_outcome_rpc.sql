BEGIN;

-- Reunião sem desfecho: o "vigia" que faltava.
--
-- Hoje a automação de no-show só dispara pelo caminho do closer: SDR clica
-- "Ganho" -> link de feedback ao closer -> closer marca no_show -> reabre +
-- cria follow-up. Mas quando o lead dá no-show, é justamente quando o SDR NÃO
-- marca "Ganho" (não foi um ganho). Resultado: a reunião passa, ninguém
-- registra desfecho, o lead fica em status 'qualified' fora de cadência, sem
-- atividade e sem notificação — em limbo (caso real: Silvana Grassi, jun/2026,
-- reunião 08/06 sem desfecho 8 dias depois).
--
-- Esta RPC retorna os leads cuja ÚLTIMA reunião já passou e que seguem sem
-- desfecho registrado, com os FATOS necessários pro endpoint decidir o estágio:
--   - estágio 1 (checkpoint): reunião + grace e ainda sem checkpoint criado
--   - estágio 2 (escalação/follow-up): checkpoint já criado há alguns dias úteis
--     e ainda sem desfecho
-- A janela de tempo precisa (24h / 2 dias úteis) é decidida no endpoint (TS),
-- onde o cálculo de dia útil já existe e é testável. A RPC só filtra o
-- universo: leads 'qualified', sem won/lost/meeting_held, reunião no passado, e
-- SEM nenhum closer_feedback_request já respondido (esses já foram tratados
-- pelo fluxo de feedback do closer — incluindo reaberturas por no_show).
--
-- Colunas retornadas:
--   lead_id, org_id, closer_id, assigned_to, won_by
--   meeting_end          -- fim (ou início) da última reunião
--   checkpoint_at        -- quando o checkpoint do estágio 1 foi criado (ou NULL)
--   escalated            -- já passou pela escalação do estágio 2?
--   has_pending_activity -- já tem atividade pendente na fila do SDR?
--   has_open_feedback    -- já tem link de feedback aberto (não respondido/não expirado)?
CREATE OR REPLACE FUNCTION public.find_meetings_pending_outcome()
RETURNS TABLE(
  lead_id uuid,
  org_id uuid,
  closer_id uuid,
  assigned_to uuid,
  won_by uuid,
  meeting_end timestamptz,
  checkpoint_at timestamptz,
  escalated boolean,
  has_pending_activity boolean,
  has_open_feedback boolean
)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH latest_meeting AS (
    -- Última reunião agendada por lead. A hora real da reunião vem do metadata
    -- da interaction (end_time, com fallback pra start_time); NÃO usamos
    -- leads.meeting_scheduled_at como hora da reunião porque ele guarda o
    -- MOMENTO DO AGENDAMENTO, não o horário marcado.
    SELECT DISTINCT ON (i.lead_id)
      i.lead_id,
      COALESCE(
        NULLIF(i.metadata->>'end_time', '')::timestamptz,
        NULLIF(i.metadata->>'start_time', '')::timestamptz
      ) AS meeting_end
    FROM interactions i
    WHERE i.type = 'meeting_scheduled'
    ORDER BY i.lead_id, i.created_at DESC
  )
  SELECT
    l.id,
    l.org_id,
    l.closer_id,
    l.assigned_to,
    l.won_by,
    lm.meeting_end,
    (SELECT max(i.created_at)
       FROM interactions i
      WHERE i.lead_id = l.id
        AND i.metadata->>'system_event' = 'meeting_outcome_checkpoint') AS checkpoint_at,
    EXISTS (
      SELECT 1 FROM interactions i
       WHERE i.lead_id = l.id
         AND i.metadata->>'system_event' = 'meeting_outcome_escalated'
    ) AS escalated,
    EXISTS (
      SELECT 1 FROM scheduled_activities sa
       WHERE sa.lead_id = l.id AND sa.status = 'pending'
    ) AS has_pending_activity,
    EXISTS (
      SELECT 1 FROM closer_feedback_requests r
       WHERE r.lead_id = l.id
         AND r.responded_at IS NULL
         AND r.expires_at > now()
    ) AS has_open_feedback
  FROM leads l
  JOIN latest_meeting lm ON lm.lead_id = l.id
  WHERE l.status = 'qualified'
    AND l.won_at IS NULL
    AND l.lost_at IS NULL
    AND l.meeting_held_at IS NULL
    AND l.deleted_at IS NULL
    AND l.archived_at IS NULL
    AND lm.meeting_end IS NOT NULL
    AND lm.meeting_end < now()
    -- Já respondido pelo closer (no_show/rescheduled reabrem e já criam
    -- follow-up; meeting_done carimba meeting_held_at) — não re-tratar.
    AND NOT EXISTS (
      SELECT 1 FROM closer_feedback_requests r2
       WHERE r2.lead_id = l.id AND r2.responded_at IS NOT NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.find_meetings_pending_outcome() TO authenticated, service_role;

COMMIT;

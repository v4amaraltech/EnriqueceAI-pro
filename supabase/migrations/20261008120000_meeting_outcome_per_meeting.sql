-- Reunião sem desfecho: avaliar CADA reunião, não o lead inteiro.
--
-- Antes: qualquer feedback de closer já respondido (inclusive "Remarcou" /
-- "No-show" de uma reunião anterior) excluía o lead para sempre, e os
-- marcadores meeting_outcome_checkpoint/escalated valiam por lead. Resultado:
-- a reunião remarcada que passava sem Ganho nunca era cobrada do SDR.
--
-- Agora:
--   * só exclui se houver feedback respondido DEPOIS do início da reunião atual;
--   * checkpoint/escalação só contam se criados depois do início da reunião atual
--     (reunião nova = ciclo novo);
--   * start_time/end_time do metadata são hora de PAREDE em BRT (sem fuso) —
--     o cast direto ::timestamptz lia como UTC (3h de diferença). Ancora em
--     America/Sao_Paulo; valor que já traz fuso é respeitado.
--
-- Mesma assinatura (RETURNS TABLE inalterado) → CREATE OR REPLACE preserva os
-- grants existentes.

BEGIN;

CREATE OR REPLACE FUNCTION public.find_meetings_pending_outcome()
 RETURNS TABLE(lead_id uuid, org_id uuid, closer_id uuid, assigned_to uuid, won_by uuid, meeting_end timestamp with time zone, checkpoint_at timestamp with time zone, escalated boolean, has_pending_activity boolean, has_open_feedback boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH latest_meeting AS (
    SELECT DISTINCT ON (i.lead_id)
      i.lead_id,
      NULLIF(i.metadata->>'start_time', '') AS start_raw,
      COALESCE(NULLIF(i.metadata->>'end_time', ''), NULLIF(i.metadata->>'start_time', '')) AS end_raw
    FROM interactions i
    WHERE i.type = 'meeting_scheduled'
    ORDER BY i.lead_id, i.created_at DESC
  ),
  meeting AS (
    SELECT
      lm.lead_id,
      CASE
        WHEN lm.start_raw IS NULL THEN NULL
        WHEN lm.start_raw ~ '(Z|[+-]\d{2}:?\d{2})$' THEN lm.start_raw::timestamptz
        ELSE lm.start_raw::timestamp AT TIME ZONE 'America/Sao_Paulo'
      END AS meeting_start,
      CASE
        WHEN lm.end_raw IS NULL THEN NULL
        WHEN lm.end_raw ~ '(Z|[+-]\d{2}:?\d{2})$' THEN lm.end_raw::timestamptz
        ELSE lm.end_raw::timestamp AT TIME ZONE 'America/Sao_Paulo'
      END AS meeting_end
    FROM latest_meeting lm
  )
  SELECT
    l.id, l.org_id, l.closer_id, l.assigned_to, l.won_by,
    m.meeting_end,
    (SELECT max(i.created_at) FROM interactions i
      WHERE i.lead_id = l.id AND i.metadata->>'system_event' = 'meeting_outcome_checkpoint'
        AND i.created_at >= COALESCE(m.meeting_start, m.meeting_end)) AS checkpoint_at,
    EXISTS (SELECT 1 FROM interactions i
       WHERE i.lead_id = l.id AND i.metadata->>'system_event' = 'meeting_outcome_escalated'
         AND i.created_at >= COALESCE(m.meeting_start, m.meeting_end)) AS escalated,
    EXISTS (SELECT 1 FROM scheduled_activities sa
       WHERE sa.lead_id = l.id AND sa.status = 'pending') AS has_pending_activity,
    EXISTS (SELECT 1 FROM closer_feedback_requests r
       WHERE r.lead_id = l.id AND r.responded_at IS NULL AND r.expires_at > now()) AS has_open_feedback
  FROM leads l
  JOIN meeting m ON m.lead_id = l.id
  WHERE l.status = 'qualified'
    AND l.won_at IS NULL AND l.lost_at IS NULL AND l.meeting_held_at IS NULL
    AND l.deleted_at IS NULL AND l.archived_at IS NULL
    AND m.meeting_end IS NOT NULL AND m.meeting_end < now()
    AND NOT EXISTS (SELECT 1 FROM closer_feedback_requests r2
      WHERE r2.lead_id = l.id AND r2.responded_at IS NOT NULL
        AND r2.responded_at >= COALESCE(m.meeting_start, m.meeting_end));
$function$;

COMMIT;

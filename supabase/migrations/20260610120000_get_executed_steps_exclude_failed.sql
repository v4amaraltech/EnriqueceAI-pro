-- get_executed_steps: do NOT treat a FAILED send as an executed step.
--
-- The SDR activity queue (fetch-pending-activities) hides any step that
-- get_executed_steps reports as done. The previous version matched ANY
-- interaction carrying a step_id, regardless of `type` — so a WhatsApp/email
-- step whose send FAILED (e.g. "instância WhatsApp não está conectada",
-- "Falha ao renovar token Gmail") was counted as executed and vanished from
-- the queue. But a failed send does NOT advance the cadence enrollment, so
-- next_step_due stays in the past and the "Atividades Atrasadas" dashboard
-- card keeps counting it. Result: the SDR sees nothing to do while the manager
-- card shows an overdue activity they cannot reconcile.
--
-- Excluding type = 'failed' makes the failed step reappear in the queue as a
-- retryable task, realigning the queue with the overdue card. Successful
-- attempts (sent/delivered/...) and post-send signals like 'bounced' still
-- count as executed (the send did happen).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_executed_steps(p_cadence_ids uuid[], p_step_ids uuid[], p_lead_ids uuid[])
 RETURNS TABLE(cadence_id uuid, step_id uuid, lead_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.cadence_id, i.step_id, i.lead_id
  FROM interactions i
  WHERE i.org_id = public.user_org_id()
    AND i.cadence_id = ANY(p_cadence_ids)
    AND i.step_id = ANY(p_step_ids)
    AND i.lead_id = ANY(p_lead_ids)
    AND i.step_id IS NOT NULL
    AND i.type <> 'failed';
END;
$function$;

COMMIT;

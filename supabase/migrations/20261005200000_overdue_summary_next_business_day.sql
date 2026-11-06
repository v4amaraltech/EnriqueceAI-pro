-- Story overdue-next-business-day (05/out/2026)
-- Resumo diário do SDR (cron sdr-overdue-summary, seg–sex 08h BRT) passa a usar
-- a mesma régua de "atrasada" do app (src/features/activities/utils/overdue.ts):
-- a tarefa é do dia em que vence e só vira atrasada a partir das 9h BRT do dia
-- útil seguinte. Antes: effective_due_brt < now() - 4h.
--
-- O resumo é lido às 08h, antes do expediente; ele conta o que estará atrasado
-- quando o SDR abrir o dia (9h de hoje) → corte = 00:00 BRT de hoje (o cron só
-- roda em dia útil). Só a linha do corte muda; demais filtros inalterados.
-- Assinatura inalterada → sem regenerar types.ts.
BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_overdue_manual_activities()
 RETURNS TABLE(lead_id uuid, assigned_to uuid, org_id uuid, channel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT l.id AS lead_id,
         l.assigned_to,
         l.org_id,
         cs.channel::text AS channel
  FROM cadence_enrollments ce
  JOIN cadences c        ON c.id = ce.cadence_id
  JOIN leads l           ON l.id = ce.lead_id
  JOIN cadence_steps cs  ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
  WHERE ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND public.effective_due_brt(ce.next_step_due)
        < (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
    AND c.type <> 'auto_email'
    AND cs.channel::text <> 'email'
    AND COALESCE(
      (cs.channel = 'whatsapp' OR (cs.channel = 'phone' AND cs.call_provider = 'whatsapp'))
      AND l.whatsapp_invalid_at IS NOT NULL, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = ce.cadence_id
        AND i.step_id = cs.id
        AND i.step_id IS NOT NULL
        AND i.lead_id = ce.lead_id
        AND i.type <> 'failed'
    )
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND l.status NOT IN ('won', 'unqualified', 'archived');
$function$;

COMMIT;

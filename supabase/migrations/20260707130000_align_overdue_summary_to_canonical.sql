-- Alinha o resumo diário de atividades atrasadas (notifyOverdueActivities) à
-- definição canônica de "atrasada" usada pelo card do dashboard e pela fila do
-- SDR (list_overdue_enrollments_brt).
--
-- PROBLEMA (07/07/2026, V4 Amaral): fetch_overdue_manual_activities usava uma
-- definição CRUA — active + next_step_due < now()-24h + channel<>'email' — sem
-- os filtros que a RPC canônica aplica. Resultado: a notificação diária dizia a
-- um SDR "144 atrasadas" enquanto o painel/fila mostravam 61. Decomposição do
-- gap (Giovanni, 144 → 61):
--   * 83  passos de WhatsApp em lead com whatsapp_invalid_at (não dá pra enviar)
--   * 3   leads terminais (won/unqualified/archived)
--   * 61  reais (== dashboard)
-- O SDR recebia um número que nunca batia com a tela dele.
--
-- CORREÇÃO: reescreve a função herdando EXATAMENTE os filtros da canônica:
--   1. cadências auto_email fora (geridas em background)
--   2. WhatsApp em número inválido fora (fila esconde esses steps)
--   3. step atual já executado fora (interaction não-failed) — igual get_executed_steps
--   4. clamp de horário comercial BRT via effective_due_brt + threshold 4h
--      (OVERDUE_THRESHOLD_HOURS do app — antes eram 24h arbitrárias)
--   5. leads terminais fora (won/unqualified/archived)
-- Mantém, POR DESIGN, channel <> 'email' (o resumo notifica só canais MANUAIS —
-- WhatsApp/Ligação/Pesquisa/LinkedIn; steps de e-mail auto-executam no cron) e a
-- natureza multi-org (sem p_org_id) que o cron sdr-overdue-summary consome.

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_overdue_manual_activities()
RETURNS TABLE(lead_id uuid, assigned_to uuid, org_id uuid, channel text)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    -- clamp horário comercial BRT + threshold de 4h (igual ao dashboard/fila)
    AND public.effective_due_brt(ce.next_step_due) < now() - interval '4 hours'
    -- 1. auto_email não entra na fila manual do SDR
    AND c.type <> 'auto_email'
    -- resumo é só de canais manuais; e-mail auto-executa no cron
    AND cs.channel::text <> 'email'
    -- 2. WhatsApp travado em número inválido (fila esconde esses steps)
    AND COALESCE(cs.channel = 'whatsapp' AND l.whatsapp_invalid_at IS NOT NULL, false) = false
    -- 3. step atual já executado — espelha get_executed_steps (type <> 'failed')
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
    -- 5. leads terminais fora
    AND l.status NOT IN ('won', 'unqualified', 'archived');
$function$;

-- Preserva a postura de segurança das migrations anteriores: só service_role
-- (usado pelo cron via createServiceRoleClient) executa; anon/authenticated não.
REVOKE EXECUTE ON FUNCTION public.fetch_overdue_manual_activities() FROM anon, authenticated, PUBLIC;

COMMIT;

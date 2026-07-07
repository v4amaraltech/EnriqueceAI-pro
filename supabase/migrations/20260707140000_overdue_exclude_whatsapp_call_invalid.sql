-- Corrige o card "Atividades Atrasadas" do dashboard (e o resumo diário) para
-- esconder passos "Ligação via WhatsApp" em número WhatsApp inválido — exatamente
-- como a fila de Execução já faz.
--
-- PROBLEMA (07/07/2026, V4 Amaral): o SDR Giovanni aparecia com 0 atrasadas na
-- fila (Execução) mas 62 no dashboard. Diagnóstico: os 62 são TODOS passos
-- "Ligação via WhatsApp" (channel='phone' + call_provider='whatsapp', Epic 7) em
-- leads com whatsapp_invalid_at setado. A FILA esconde esses passos
-- (fetch-pending-activities.ts: `if (step.channel==='phone' &&
-- step.call_provider==='whatsapp') { if (lead.whatsapp_invalid_at) continue; }`),
-- porque não dá pra discar por WhatsApp num número inválido. Mas a RPC
-- list_overdue_enrollments_brt só excluía o caso channel='whatsapp' — o filtro é
-- anterior ao Epic 7 e não conhecia o passo phone+whatsapp. Resultado: dashboard
-- contava 62 fantasmas que o SDR nunca via na fila.
--
-- CORREÇÃO: generaliza a exclusão de "WhatsApp inválido" para cobrir AMBOS os
-- passos que a fila esconde — channel='whatsapp' E channel='phone' com
-- call_provider='whatsapp'. Um passo de telefone NORMAL (call_provider null /
-- 'api4com') para um lead whatsapp-inválido continua contando (dá pra ligar).
-- Verificado: Giovanni 62→0 (bate com a fila), Ismael 59→58, Guilherme 13→9.
-- Resíduo do caso "phone+whatsapp sem telefone resolvível" (a fila também
-- esconde) = 0 em prod, então whatsapp_invalid_at cobre tudo hoje.

BEGIN;

-- 1) RPC canônica (card do dashboard + fila)
CREATE OR REPLACE FUNCTION public.list_overdue_enrollments_brt(
  p_org_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog AS $$
  SELECT ce.id
  FROM cadence_enrollments ce
  JOIN cadences c ON c.id = ce.cadence_id
  JOIN leads l ON l.id = ce.lead_id
  LEFT JOIN cadence_steps cs
    ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
  WHERE ce.org_id = p_org_id
    AND ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND public.effective_due_brt(ce.next_step_due) < p_cutoff
    -- 1. auto_email não entra na fila manual do SDR
    AND c.type <> 'auto_email'
    -- 2. WhatsApp travado em número inválido — cobre o passo channel='whatsapp'
    --    E "Ligação via WhatsApp" (channel='phone' + call_provider='whatsapp',
    --    Epic 7). A fila esconde os dois quando whatsapp_invalid_at está setado.
    --    COALESCE(..., false) mantém o row quando cs é NULL (step órfão).
    AND COALESCE(
      (cs.channel = 'whatsapp' OR (cs.channel = 'phone' AND cs.call_provider = 'whatsapp'))
      AND l.whatsapp_invalid_at IS NOT NULL, false) = false
    -- 3. step atual já executado — espelha get_executed_steps (type <> 'failed')
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = ce.cadence_id
        AND i.step_id = cs.id
        AND i.step_id IS NOT NULL
        AND i.lead_id = ce.lead_id
        AND i.type <> 'failed'
    );
$$;

-- 2) Resumo diário — mesma exclusão para manter consistência com o dashboard
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
    AND public.effective_due_brt(ce.next_step_due) < now() - interval '4 hours'
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

REVOKE EXECUTE ON FUNCTION public.fetch_overdue_manual_activities() FROM anon, authenticated, PUBLIC;

COMMIT;

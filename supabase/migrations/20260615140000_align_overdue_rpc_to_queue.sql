BEGIN;

-- Alinha o card "Atividades Atrasadas" do dashboard com a fila real do SDR.
--
-- Antes, o RPC contava qualquer enrollment `active` com `next_step_due` vencido,
-- mesmo quando a fila do SDR (fetch-pending-activities) esconde aquele step. Isso
-- inflava o dashboard com "fantasmas": enrollments presos num step já feito ou
-- bloqueado, invisíveis pro SDR — ele jurava não ter atrasadas e estava certo.
--
-- Diagnóstico (15/06/2026, V4 Amaral): de 251 contadas, ~100 eram fantasmas
-- (77 steps de Pesquisa já executados que não avançaram o enrollment + 22 steps
-- de WhatsApp travados em número marcado como inválido), quase todas de 1 SDR
-- cuja fila estava vazia.
--
-- Agora o RPC exclui exatamente os mesmos casos que a fila esconde:
--   1. cadências auto_email (geridas em background, fora da fila manual do SDR)
--   2. step atual de WhatsApp em lead com whatsapp_invalid_at (fila: linha 165)
--   3. step atual que já tem interaction não-failed (mesma regra do get_executed_steps)
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
    -- 2. WhatsApp travado em número inválido (fila esconde esses steps).
    --    COALESCE(..., false) mantém o row quando cs é NULL (step órfão).
    AND COALESCE(cs.channel = 'whatsapp' AND l.whatsapp_invalid_at IS NOT NULL, false) = false
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

COMMIT;

BEGIN;

-- Card "Atividades Atrasadas" do dashboard passa a contar TAREFAS (passos),
-- não mais LEADS — batendo 1:1 com a tela de execução do SDR
-- ("Atividades das Cadências (N)" com o filtro "Atrasada").
--
-- Contexto (09/07/2026, V4 Amaral): o card contava 1 por lead
-- (list_overdue_enrollments_brt → distinct lead), enquanto a fila do SDR
-- (fetch-pending-activities) expande cada enrollment em TODOS os passos da
-- janela de 24h e marca cada passo vencido >4h. Um lead como AMOR SAUDE com
-- 3 passos vencidos (Ligação + WhatsApp + Ligação) conta 3 na tela do SDR e
-- contava 1 no card → gestor via 104 no dashboard e 162 na fila. Decisão do
-- gestor: card por TAREFA (igual à fila).
--
-- Este RPC é o irmão "por passo" de list_overdue_enrollments_brt: mesma
-- definição de atraso (effective_due_brt < cutoff), mesmas supressões
-- (auto_email, WhatsApp/Ligação-WhatsApp em número inválido, passo já
-- executado), mas expandindo os passos da janela de 24h como a fila faz.
--
-- Espelha fetch-pending-activities.ts:
--   - base: enrollment active, next_step_due <= now(), cadência não auto_email
--   - expande passos com step_order >= current_step enquanto o atraso
--     acumulado (delay_days*24 + delay_hours dos passos além do atual) <= 24h
--   - cada passo vence em next_step_due + atraso acumulado; "atrasado" quando
--     effective_due_brt(esse vencimento) < p_cutoff (o app passa now()-4h)
--   - supressão WhatsApp inválido cobre channel='whatsapp' OU
--     (channel='phone' AND call_provider='whatsapp'), Epic 7 (fila: ~linha 167/172)
--   - exclui passo já executado (mesma regra do get_executed_steps: type<>'failed')
--
-- Diferente do RPC por-enrollment, este NÃO exclui leads em status terminal —
-- a fila do SDR também não exclui, então manter a exclusão quebraria o "bate
-- 1:1". Hoje o impacto é zero (nenhum lead terminal com passo vencido), mas
-- fica explícito. Retorna assigned_to pra o card agrupar por SDR sem re-query.
CREATE OR REPLACE FUNCTION public.list_overdue_activities_brt(
  p_org_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE(enrollment_id uuid, lead_id uuid, step_id uuid, assigned_to uuid)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog AS $$
  WITH base AS (
    SELECT ce.id AS enr_id, ce.cadence_id, ce.lead_id, ce.current_step,
           ce.next_step_due, l.assigned_to, l.whatsapp_invalid_at
    FROM cadence_enrollments ce
    JOIN cadences c ON c.id = ce.cadence_id
    JOIN leads l ON l.id = ce.lead_id
    WHERE ce.org_id = p_org_id
      AND ce.status = 'active'
      AND ce.next_step_due IS NOT NULL
      AND ce.next_step_due <= now()
      AND c.type <> 'auto_email'
      -- lead soft-deletado não aparece na fila do SDR (RLS esconde deleted_at);
      -- sem isto o card contaria tarefas de leads deletados e furaria o "bate 1:1".
      AND l.deleted_at IS NULL
  ),
  expanded AS (
    SELECT b.enr_id, b.cadence_id, b.lead_id, b.next_step_due, b.assigned_to,
           b.whatsapp_invalid_at, s.id AS step_id, s.channel, s.call_provider,
           SUM(CASE WHEN s.step_order > b.current_step
                    THEN s.delay_days * 24 + s.delay_hours ELSE 0 END)
             OVER (PARTITION BY b.enr_id ORDER BY s.step_order) AS cum_hours
    FROM base b
    JOIN cadence_steps s
      ON s.cadence_id = b.cadence_id AND s.step_order >= b.current_step
  )
  SELECT e.enr_id, e.lead_id, e.step_id, e.assigned_to
  FROM expanded e
  WHERE e.cum_hours <= 24
    AND public.effective_due_brt(
          e.next_step_due + make_interval(hours => e.cum_hours::int)
        ) < p_cutoff
    -- WhatsApp / Ligação-WhatsApp travado em número inválido (fila esconde)
    AND COALESCE(
          (e.channel = 'whatsapp' OR (e.channel = 'phone' AND e.call_provider = 'whatsapp'))
          AND e.whatsapp_invalid_at IS NOT NULL, false) = false
    -- passo já executado — espelha get_executed_steps (type <> 'failed')
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = e.cadence_id
        AND i.step_id = e.step_id
        AND i.step_id IS NOT NULL
        AND i.lead_id = e.lead_id
        AND i.type <> 'failed'
    );
$$;

COMMIT;

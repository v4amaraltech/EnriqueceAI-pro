-- ============================================================================
-- Auditoria: leads "sumidos" (saída de cadência sem rastro na timeline)
-- ============================================================================
--
-- A timeline do lead (fetchLeadTimeline) é construída exclusivamente a partir
-- da tabela `interactions`. Quando um enrollment é encerrado sem que nenhuma
-- linha explique o porquê, o lead some da cadência sem deixar pista — foi o
-- padrão dos incidentes de auto-perda (51 leads) e do "Ignorar atividade"
-- (899 leads).
--
-- Este script lista APENAS os casos genuínos, filtrando os finais legítimos:
--   - fim natural da cadência (chegou no último passo)
--   - re-inscrição / troca de cadência (tem enrollment ativo/pausado)
--   - retorno agendado (tem scheduled_activity pendente)
--   - qualquer system_event de saída registrado perto do completed_at
--     (lead_lost, lead_won, cadence_ignored, meeting_scheduled, cadence_switched,
--      prospection_scheduled, enrollment_*, activity_scheduled, etc.)
--
-- USO:
--   Rodar no SQL editor do Supabase (ou psql). Ajuste os dois parâmetros abaixo.
--   :org_id        -> org a auditar (V4 Amaral = c2727473-1df8-4faa-9264-a9fc1759fe3b)
--   janela         -> troque 'interval ''14 days''' para o período desejado.
--
-- Resultado vazio = nenhum lead sumido no período. 🎉
-- ============================================================================

WITH params AS (
  SELECT
    'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid AS org_id,
    (now() - interval '14 days')                 AS desde
),
recent_completed AS (
  SELECT
    ce.id           AS enrollment_id,
    ce.lead_id,
    ce.cadence_id,
    ce.completed_at,
    ce.current_step,
    l.status        AS lead_status,
    COALESCE(l.nome_fantasia, l.razao_social) AS lead_name,
    c.name          AS cadence_name,
    (SELECT max(step_order) FROM cadence_steps s WHERE s.cadence_id = ce.cadence_id) AS ultimo_passo
  FROM cadence_enrollments ce
  JOIN params p   ON true
  JOIN leads l    ON l.id = ce.lead_id
  JOIN cadences c ON c.id = ce.cadence_id
  WHERE ce.status = 'completed'
    AND ce.completed_at >= p.desde
    AND l.org_id = p.org_id
    AND l.deleted_at IS NULL
    AND l.status IN ('new', 'contacted', 'qualified')  -- won/unqualified/archived têm saída legítima
)
SELECT
  rc.lead_id,
  rc.lead_name,
  rc.lead_status,
  rc.cadence_name,
  rc.current_step,
  rc.ultimo_passo,
  rc.completed_at
FROM recent_completed rc
WHERE
  -- 1) cortado no meio (fim natural não é problema)
  rc.current_step < rc.ultimo_passo
  -- 2) não foi re-inscrito / trocado de cadência
  AND NOT EXISTS (
    SELECT 1 FROM cadence_enrollments e2
    WHERE e2.lead_id = rc.lead_id AND e2.status IN ('active', 'paused')
  )
  -- 3) não tem retorno agendado pendente
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_activities sa
    WHERE sa.lead_id = rc.lead_id AND sa.status = 'pending'
  )
  -- 4) não há nenhum evento explicando a saída perto do completed_at
  AND NOT EXISTS (
    SELECT 1 FROM interactions i
    WHERE i.lead_id = rc.lead_id
      AND i.created_at BETWEEN rc.completed_at - interval '5 min'
                           AND rc.completed_at + interval '5 min'
      AND (
        i.type IN ('meeting_scheduled', 'replied', 'bounced')
        OR i.metadata->>'system_event' IS NOT NULL
      )
  )
ORDER BY rc.completed_at DESC;

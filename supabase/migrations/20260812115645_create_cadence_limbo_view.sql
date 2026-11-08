BEGIN;

-- Rede de segurança: leads em "limbo de cadência" — status='contacted' (vivos)
-- sem NENHUMA cadência ativa e sem NENHUMA atividade agendada pendente.
-- Uma vez nesse estado o lead não aparece em fila nenhuma e não volta sozinho.
--
-- Critério idêntico ao diagnóstico validado (647 leads em 12/08/2026):
--   * exclui só enrollment 'active' (leads 'paused' TAMBÉM são limbo — nada
--     os despausa automaticamente), diferente de leads_no_active_enrollment
--     que exclui 'active' E 'paused'.
--   * exclui quem tem scheduled_activities 'pending'.
--
-- security_invoker=true mantém a RLS das tabelas base — a mesma view serve tanto
-- ao alerta (via service role, org-wide) quanto a um futuro filtro "Em limbo" em
-- /leads (via authenticated, escopado por org).

CREATE OR REPLACE VIEW public.v_leads_cadence_limbo
WITH (security_invoker = true) AS
SELECT l.*
FROM leads l
WHERE l.status = 'contacted'
  AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cadence_enrollments ce
    WHERE ce.lead_id = l.id
      AND ce.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM scheduled_activities sa
    WHERE sa.lead_id = l.id
      AND sa.status = 'pending'
  );

COMMENT ON VIEW public.v_leads_cadence_limbo IS
  'Leads em limbo de cadência: status=contacted (vivos) sem enrollment ativo e sem scheduled_activity pendente. Fonte do alerta diário cadence-limbo e de um futuro filtro "Em limbo".';

GRANT SELECT ON public.v_leads_cadence_limbo TO authenticated;

COMMIT;

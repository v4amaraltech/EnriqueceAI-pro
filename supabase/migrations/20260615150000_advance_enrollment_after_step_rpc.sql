BEGIN;

-- Avanço atômico de enrollment após a execução de um step manual.
--
-- Antes, executeActivity gravava a interaction e DEPOIS avançava o enrollment
-- em ~5 round-trips JS (queries de step/enrollment/next + insert de skipped +
-- update). Se qualquer round-trip falhasse entre o insert da interaction e o
-- UPDATE final, o enrollment ficava preso num step já feito — invisível na fila
-- (get_executed_steps esconde) e inflando "Atividades Atrasadas". O guard de
-- idempotência ainda barrava o retry, tornando o estado permanente (77 steps de
-- Pesquisa presos em V4 Amaral, jun/2026).
--
-- Este RPC faz tudo numa transação única, com a linha do enrollment travada
-- (FOR UPDATE) pra serializar execuções concorrentes, e é IDEMPOTENTE: se o
-- enrollment já avançou além do step executado, não faz nada. Assim o avanço
-- não pode mais ser "estrangulado" por falha parcial, e o caminho de idempotência
-- do executeActivity pode chamá-lo pra reconciliar em vez de dar erro.
--
-- Retorna: advanced (avançou current_step), completed (encerrou a cadência),
-- new_step (novo current_step, ou o antigo se nada mudou).
CREATE OR REPLACE FUNCTION public.advance_enrollment_after_step(
  p_enrollment_id uuid,
  p_executed_step_id uuid,
  p_performed_by uuid
)
RETURNS TABLE(advanced boolean, completed boolean, new_step integer)
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cadence_id uuid;
  v_lead_id uuid;
  v_org_id uuid;
  v_executed_order integer;
  v_old_step integer;
  v_next_order integer;
BEGIN
  -- Trava a linha do enrollment ativo (serializa execuções concorrentes).
  SELECT ce.cadence_id, ce.lead_id, ce.org_id, ce.current_step
    INTO v_cadence_id, v_lead_id, v_org_id, v_old_step
  FROM cadence_enrollments ce
  WHERE ce.id = p_enrollment_id AND ce.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::integer;
    RETURN;
  END IF;

  SELECT cs.step_order INTO v_executed_order
  FROM cadence_steps cs
  WHERE cs.id = p_executed_step_id AND cs.cadence_id = v_cadence_id;

  IF v_executed_order IS NULL THEN
    RETURN QUERY SELECT false, false, v_old_step;
    RETURN;
  END IF;

  -- Idempotente: enrollment já avançou além do step executado → nada a fazer.
  IF v_old_step > v_executed_order THEN
    RETURN QUERY SELECT false, false, v_old_step;
    RETURN;
  END IF;

  -- Audita steps pulados no intervalo [v_old_step, v_executed_order) — mantém
  -- a timeline completa quando o SDR executa um step à frente do cursor.
  INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, performed_by, metadata)
  SELECT v_org_id, v_lead_id, v_cadence_id, s.id, 'system', 'sent',
         'Etapa ' || s.step_order || ' pulada — SDR executou a etapa ' || v_executed_order || ' primeiro.',
         p_performed_by,
         jsonb_build_object(
           'system_event', 'step_skipped',
           'reason', 'advanced_past',
           'skipped_step_order', s.step_order,
           'executed_step_order', v_executed_order
         )
  FROM cadence_steps s
  WHERE s.cadence_id = v_cadence_id
    AND s.step_order >= v_old_step
    AND s.step_order < v_executed_order;

  -- Próximo step após o executado.
  SELECT MIN(cs.step_order) INTO v_next_order
  FROM cadence_steps cs
  WHERE cs.cadence_id = v_cadence_id AND cs.step_order > v_executed_order;

  IF v_next_order IS NOT NULL THEN
    -- Trigger calculate_next_step_due recalcula next_step_due no UPDATE.
    UPDATE cadence_enrollments SET current_step = v_next_order WHERE id = p_enrollment_id;
    RETURN QUERY SELECT true, false, v_next_order;
  ELSE
    UPDATE cadence_enrollments SET status = 'completed', completed_at = now() WHERE id = p_enrollment_id;
    RETURN QUERY SELECT true, true, v_old_step;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_enrollment_after_step(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;

-- BDR-2 — Telefone inválido encerra a cadência de contato (decisão do usuário em 22/09/2026)
--
-- Na primeira rodada real, `chamada_falhou` com `motivo = numero_invalido` avançava a
-- inscrição para a ligação 2, que falharia de novo (e a 3 e a 4). Agora, nesse caso
-- (e no `telefone_invalido` sintético do executor, lead sem telefone), a inscrição na
-- cadência de contato é ENCERRADA (`completed`) na hora, com rastro na timeline.
-- O lead NÃO é marcado como perdido: as demais cadências (e-mail) seguem —
-- markLeadLostOnCadenceEnd já pula quem tem outra inscrição aberta, e a rota
-- não o chama porque `completed` volta false com motivo próprio.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_external_step(
  p_org_id        UUID,
  p_event_id      UUID,
  p_execution_id  UUID,
  p_evento        TEXT,
  p_call_sid      TEXT    DEFAULT NULL,
  p_resultado     JSONB   DEFAULT '{}'::jsonb,
  p_payload       JSONB   DEFAULT '{}'::jsonb,
  p_performed_by  UUID    DEFAULT NULL
)
RETURNS TABLE (
  aplicado        BOOLEAN,
  duplicado       BOOLEAN,
  motivo          TEXT,
  enrollment_id   UUID,
  lead_id         UUID,
  cadence_id      UUID,
  step_id         UUID,
  interaction_id  UUID,
  advanced        BOOLEAN,
  completed       BOOLEAN,
  new_step        INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_evt          external_step_events%ROWTYPE;
  v_exec         cadence_step_executions%ROWTYPE;
  v_ce           cadence_enrollments%ROWTYPE;
  v_inserted     INTEGER := 0;
  v_terminal     BOOLEAN := p_evento IN ('chamada_finalizada', 'caixa_postal', 'chamada_falhou');
  v_falha        TEXT := COALESCE(p_payload ->> 'motivo', '');
  v_tel_invalido BOOLEAN := p_evento = 'chamada_falhou' AND COALESCE(p_payload ->> 'motivo', '') IN ('numero_invalido', 'telefone_invalido');
  v_performed_by UUID;
  v_interaction  UUID;
  v_type         TEXT;
  v_resumo       TEXT;
  v_adv          RECORD;
BEGIN
  -- 1. Idempotência por event_id (outbox do V4 Call).
  INSERT INTO external_step_events (event_id, org_id, execution_id, evento, call_sid, payload)
  VALUES (p_event_id, p_org_id, p_execution_id, COALESCE(p_evento, '?'), p_call_sid, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT * INTO v_evt FROM external_step_events e WHERE e.event_id = p_event_id;
    RETURN QUERY SELECT false, true, 'event_id_ja_processado'::text,
                        v_evt.enrollment_id, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
                        false, false, NULL::integer;
    RETURN;
  END IF;

  -- 2. Execução (trava a linha; serializa dois eventos da mesma execução).
  SELECT * INTO v_exec FROM cadence_step_executions x
   WHERE x.execution_id = p_execution_id AND x.org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE external_step_events SET motivo = 'execution_id_desconhecida' WHERE event_id = p_event_id;
    RETURN QUERY SELECT false, false, 'execution_id_desconhecida'::text,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, false, false, NULL::integer;
    RETURN;
  END IF;
  UPDATE external_step_events SET enrollment_id = v_exec.enrollment_id WHERE event_id = p_event_id;

  IF NOT v_terminal THEN
    UPDATE external_step_events SET motivo = 'evento_nao_terminal' WHERE event_id = p_event_id;
    RETURN QUERY SELECT false, false, 'evento_nao_terminal'::text,
                        v_exec.enrollment_id, NULL::uuid, v_exec.cadence_id, v_exec.step_id, NULL::uuid,
                        false, false, NULL::integer;
    RETURN;
  END IF;

  IF v_exec.confirmed_at IS NOT NULL THEN
    UPDATE external_step_events SET motivo = 'execucao_ja_confirmada' WHERE event_id = p_event_id;
    RETURN QUERY SELECT false, false, 'execucao_ja_confirmada'::text,
                        v_exec.enrollment_id, NULL::uuid, v_exec.cadence_id, v_exec.step_id, v_exec.interaction_id,
                        false, false, NULL::integer;
    RETURN;
  END IF;

  -- 3. Inscrição: confere passo atual.
  SELECT * INTO v_ce FROM cadence_enrollments ce WHERE ce.id = v_exec.enrollment_id FOR UPDATE;

  UPDATE cadence_step_executions
     SET confirmed_at = now(), confirmed_event_id = p_event_id, evento = p_evento,
         call_sid = COALESCE(p_call_sid, call_sid), lease_until = NULL
   WHERE cadence_step_executions.execution_id = p_execution_id;

  IF v_ce.id IS NULL OR v_ce.status <> 'active' OR v_ce.current_step <> v_exec.step_order THEN
    IF v_ce.id IS NOT NULL AND v_ce.execution_id = p_execution_id THEN
      UPDATE cadence_enrollments SET execution_id = NULL, lease_until = NULL, lease_owner = NULL
       WHERE id = v_ce.id;
    END IF;
    UPDATE external_step_events SET motivo = 'passo_ja_avancado' WHERE event_id = p_event_id;
    RETURN QUERY SELECT false, false, 'passo_ja_avancado'::text,
                        v_exec.enrollment_id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, NULL::uuid,
                        false, false, v_ce.current_step;
    RETURN;
  END IF;

  -- 4. Interaction do passo.
  SELECT COALESCE(p_performed_by, v_ce.pending_assigned_to, l.assigned_to, c.created_by)
    INTO v_performed_by
    FROM leads l LEFT JOIN cadences c ON c.id = v_ce.cadence_id
   WHERE l.id = v_ce.lead_id;

  v_type := CASE WHEN p_evento = 'chamada_falhou' THEN 'failed' ELSE 'sent' END;
  v_resumo := COALESCE(
    NULLIF(p_resultado ->> 'resumo', ''),
    CASE p_evento
      WHEN 'chamada_finalizada' THEN 'Ligação realizada pela Ana (V4 Call).'
      WHEN 'caixa_postal'       THEN 'Ligação caiu na caixa postal.'
      WHEN 'chamada_falhou'     THEN 'Ligação falhou (' || COALESCE(NULLIF(v_falha, ''), 'falha_na_ligacao') || ').'
    END);

  INSERT INTO interactions
    (org_id, lead_id, cadence_id, step_id, channel, type, message_content, ai_generated, performed_by, external_id, metadata)
  VALUES
    (v_ce.org_id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, 'phone', v_type::interaction_type, v_resumo, true,
     v_performed_by, p_call_sid,
     jsonb_strip_nulls(jsonb_build_object(
       'source', 'v4call',
       'evento', p_evento,
       'event_id', p_event_id,
       'execution_id', p_execution_id,
       'call_sid', p_call_sid,
       'tentativa', v_exec.attempt,
       'resultado', p_resultado,
       'motivo', p_payload ->> 'motivo',
       'error_code', p_payload ->> 'error_code',
       'gravacao_url', p_payload ->> 'gravacao_url',
       'duracao_total_seg', (p_payload ->> 'duracao_total_seg')::numeric,
       'numero_utilizado', p_payload ->> 'numero_utilizado',
       'transcricao_texto', p_payload ->> 'transcricao_texto'
     )))
  RETURNING id INTO v_interaction;

  UPDATE cadence_step_executions SET interaction_id = v_interaction
   WHERE cadence_step_executions.execution_id = p_execution_id;
  UPDATE cadence_enrollments SET execution_id = NULL, lease_until = NULL, lease_owner = NULL
   WHERE id = v_ce.id;

  -- 4b. Telefone inválido: encerra a cadência de contato agora (não há o que rediscar).
  --     Não avança, não marca contatado, não marca perdido (outras cadências seguem).
  IF v_tel_invalido THEN
    UPDATE cadence_enrollments SET status = 'completed', completed_at = now() WHERE id = v_ce.id;
    INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, performed_by, metadata)
    VALUES (v_ce.org_id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, 'system', 'sent',
            'Cadência de contato encerrada: telefone inválido (' || v_falha || '). As demais cadências do lead seguem.',
            v_performed_by,
            jsonb_build_object('system_event', 'cadence_ended_phone_invalid', 'reason', v_falha,
                               'enrollment_id', v_ce.id, 'execution_id', p_execution_id, 'call_sid', p_call_sid,
                               'telefone', (SELECT telefone FROM leads WHERE id = v_ce.lead_id)));
    UPDATE external_step_events SET aplicado = true, motivo = 'aplicado_encerrado_telefone_invalido' WHERE event_id = p_event_id;
    RETURN QUERY SELECT true, false, 'aplicado_encerrado_telefone_invalido'::text,
                        v_ce.id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, v_interaction,
                        false, false, NULL::integer;
    RETURN;
  END IF;

  -- Primeiro contato do lead (mesma regra de markLeadContacted).
  UPDATE leads SET status = 'contacted', contacted_at = now() WHERE id = v_ce.lead_id AND status = 'new';
  UPDATE leads SET contacted_at = now() WHERE id = v_ce.lead_id AND contacted_at IS NULL;

  -- 5. Avanço atômico e idempotente.
  SELECT a.advanced, a.completed, a.new_step INTO v_adv
    FROM public.advance_enrollment_after_step(v_ce.id, v_exec.step_id, v_performed_by) a;

  UPDATE external_step_events SET aplicado = true, motivo = 'aplicado' WHERE event_id = p_event_id;

  RETURN QUERY SELECT true, false, 'aplicado'::text,
                      v_ce.id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, v_interaction,
                      COALESCE(v_adv.advanced, false), COALESCE(v_adv.completed, false), v_adv.new_step;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_external_step(UUID, UUID, UUID, TEXT, TEXT, JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_external_step(UUID, UUID, UUID, TEXT, TEXT, JSONB, JSONB, UUID) TO service_role;
COMMENT ON FUNCTION public.confirm_external_step(UUID, UUID, UUID, TEXT, TEXT, JSONB, JSONB, UUID) IS
  'BDR-2: aplica evento terminal do V4 Call ao passo reservado — idempotente por event_id e execution_id; 1 interaction, 1 avanço. Telefone inválido encerra a cadência de contato.';

COMMIT;

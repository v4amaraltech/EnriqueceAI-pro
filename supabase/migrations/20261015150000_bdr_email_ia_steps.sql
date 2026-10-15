-- BDR — E-mail da Ana como atividade da cadência de contato (fora do motor auto_email).
--
-- O executor (n8n) reserva o passo de e-mail com claim_due_steps(p_channel => 'email'),
-- a IA escreve o e-mail e a rota POST /api/v1/bdr/steps/email envia pela caixa da Ana.
-- Duas RPCs garantem "no máximo um e-mail por passo":
--   begin_email_step   grava a intenção (Message-ID gerado antes do envio) uma única vez
--                      por execução; se já existe, devolve 'ja_iniciado' e a rota NÃO reenvia.
--   confirm_email_step registra a interaction de e-mail (enviado / falhou / incerto) no
--                      histórico do lead e avança o passo (advance_enrollment_after_step).
-- As duas usam external_step_events (idempotência por event_id determinístico).

CREATE OR REPLACE FUNCTION public.begin_email_step(
  p_org_id          UUID,
  p_execution_id    UUID,
  p_rfc_message_id  TEXT
)
RETURNS TABLE(estado TEXT, rfc_message_id TEXT, enrollment_id UUID, lead_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_exec      cadence_step_executions%ROWTYPE;
  v_lead      UUID;
  v_event_id  UUID := uuid_generate_v5('a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'::uuid, p_execution_id::text || '|email_intent');
  v_inserted  INTEGER := 0;
BEGIN
  SELECT * INTO v_exec FROM cadence_step_executions x
   WHERE x.execution_id = p_execution_id AND x.org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'execution_id_desconhecida'::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT ce.lead_id INTO v_lead FROM cadence_enrollments ce WHERE ce.id = v_exec.enrollment_id;

  IF v_exec.channel <> 'email' THEN
    RETURN QUERY SELECT 'canal_nao_e_email'::text, NULL::text, v_exec.enrollment_id, v_lead;
    RETURN;
  END IF;
  IF v_exec.confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'execucao_ja_confirmada'::text, NULL::text, v_exec.enrollment_id, v_lead;
    RETURN;
  END IF;

  INSERT INTO external_step_events (event_id, org_id, execution_id, enrollment_id, evento, payload, motivo)
  VALUES (v_event_id, p_org_id, p_execution_id, v_exec.enrollment_id, 'email_enviando',
          jsonb_build_object('rfc_message_id', p_rfc_message_id), 'intencao_de_envio')
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN QUERY SELECT 'ja_iniciado'::text,
                        (SELECT e.payload ->> 'rfc_message_id' FROM external_step_events e WHERE e.event_id = v_event_id),
                        v_exec.enrollment_id, v_lead;
    RETURN;
  END IF;

  UPDATE cadence_step_executions SET evento = 'email_enviando' WHERE execution_id = p_execution_id;
  RETURN QUERY SELECT 'iniciado'::text, p_rfc_message_id, v_exec.enrollment_id, v_lead;
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_email_step(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_email_step(UUID, UUID, TEXT) TO service_role;


CREATE OR REPLACE FUNCTION public.confirm_email_step(
  p_org_id            UUID,
  p_execution_id      UUID,
  p_evento            TEXT,              -- email_enviado | email_falhou | email_incerto
  p_performed_by      UUID,              -- usuário dono da caixa que enviou (vigia de respostas usa o token dele)
  p_gmail_message_id  TEXT DEFAULT NULL,
  p_conteudo          TEXT DEFAULT NULL,
  p_metadata          JSONB DEFAULT '{}'::jsonb,
  p_interaction_id    UUID DEFAULT NULL      -- id gerado antes do envio (pixel de abertura aponta para ele)
)
RETURNS TABLE(aplicado boolean, duplicado boolean, motivo text, enrollment_id uuid, lead_id uuid,
              interaction_id uuid, advanced boolean, completed boolean, new_step integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_event_id    UUID := uuid_generate_v5('a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'::uuid, p_execution_id::text || '|email_confirm');
  v_exec        cadence_step_executions%ROWTYPE;
  v_ce          cadence_enrollments%ROWTYPE;
  v_inserted    INTEGER := 0;
  v_interaction UUID;
  v_adv         RECORD;
BEGIN
  IF p_evento NOT IN ('email_enviado', 'email_falhou', 'email_incerto') THEN
    RAISE EXCEPTION 'evento inválido: %', p_evento;
  END IF;

  INSERT INTO external_step_events (event_id, org_id, execution_id, evento, payload)
  VALUES (v_event_id, p_org_id, p_execution_id, p_evento,
          COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('gmail_message_id', p_gmail_message_id))
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN QUERY SELECT false, true, 'event_id_ja_processado'::text, NULL::uuid, NULL::uuid, NULL::uuid,
                        false, false, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_exec FROM cadence_step_executions x
   WHERE x.execution_id = p_execution_id AND x.org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE external_step_events SET motivo = 'execution_id_desconhecida' WHERE event_id = v_event_id;
    RETURN QUERY SELECT false, false, 'execution_id_desconhecida'::text, NULL::uuid, NULL::uuid, NULL::uuid,
                        false, false, NULL::integer;
    RETURN;
  END IF;
  UPDATE external_step_events SET enrollment_id = v_exec.enrollment_id WHERE event_id = v_event_id;

  IF v_exec.confirmed_at IS NOT NULL THEN
    UPDATE external_step_events SET motivo = 'execucao_ja_confirmada' WHERE event_id = v_event_id;
    RETURN QUERY SELECT false, false, 'execucao_ja_confirmada'::text, v_exec.enrollment_id, NULL::uuid,
                        v_exec.interaction_id, false, false, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_ce FROM cadence_enrollments ce WHERE ce.id = v_exec.enrollment_id FOR UPDATE;

  -- O e-mail já saiu (ou pode ter saído): o histórico registra SEMPRE, mesmo se o passo já mudou.
  INSERT INTO interactions
    (id, org_id, lead_id, cadence_id, step_id, channel, type, message_content, ai_generated, performed_by, external_id, metadata)
  VALUES
    (COALESCE(p_interaction_id, gen_random_uuid()), v_exec.org_id, v_ce.lead_id, v_exec.cadence_id, v_exec.step_id, 'email',
     (CASE WHEN p_evento = 'email_enviado' THEN 'sent' ELSE 'failed' END)::interaction_type,
     p_conteudo, true, p_performed_by,
     CASE WHEN p_evento = 'email_enviado' THEN p_gmail_message_id END,
     jsonb_strip_nulls(COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
       'source', 'ana_ia_email',
       'evento', p_evento,
       'execution_id', p_execution_id,
       'tentativa', v_exec.attempt)))
  RETURNING id INTO v_interaction;

  UPDATE cadence_step_executions
     SET confirmed_at = now(), confirmed_event_id = v_event_id, evento = p_evento,
         interaction_id = v_interaction, lease_until = NULL
   WHERE cadence_step_executions.execution_id = p_execution_id;

  IF v_ce.id IS NULL OR v_ce.status <> 'active' OR v_ce.current_step <> v_exec.step_order THEN
    IF v_ce.id IS NOT NULL AND v_ce.execution_id = p_execution_id THEN
      UPDATE cadence_enrollments SET execution_id = NULL, lease_until = NULL, lease_owner = NULL WHERE id = v_ce.id;
    END IF;
    UPDATE external_step_events SET aplicado = true, motivo = 'registrado_passo_ja_avancado' WHERE event_id = v_event_id;
    RETURN QUERY SELECT true, false, 'registrado_passo_ja_avancado'::text, v_ce.id, v_ce.lead_id, v_interaction,
                        false, false, v_ce.current_step;
    RETURN;
  END IF;

  UPDATE cadence_enrollments SET execution_id = NULL, lease_until = NULL, lease_owner = NULL WHERE id = v_ce.id;

  SELECT a.advanced, a.completed, a.new_step INTO v_adv
    FROM public.advance_enrollment_after_step(v_ce.id, v_exec.step_id, p_performed_by) a;

  UPDATE external_step_events SET aplicado = true, motivo = 'aplicado' WHERE event_id = v_event_id;
  RETURN QUERY SELECT true, false, 'aplicado'::text, v_ce.id, v_ce.lead_id, v_interaction,
                      COALESCE(v_adv.advanced, false), COALESCE(v_adv.completed, false), v_adv.new_step;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_email_step(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_email_step(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, UUID) TO service_role;

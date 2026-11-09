-- PR corretivo ao PR10/PR550: auditoria permanente de recuperacao autorizada.
-- Renomeada de 20261108110000 para 20261108200000 para evitar colisao com
-- org_takeover_hardening.sql (ambas tinham timestamp 110000).
--
-- Aditiva e forward-only. Cria tabela append-only para trilha permanente de
-- recuperacoes autorizadas, RPC transacional e sem apagar justificativa do gestor.
-- RLS por org. Escrita somente service_role via RPC. Nenhuma coluna do PR10 e alterada.
--
-- Principios:
--   * Append-only permanente: cada recuperacao autorizada vira uma linha nova.
--     DELETE nunca e concedido. FK da instancia e NO ACTION: apagar o numero nao
--     apaga o historico de auditoria.
--   * Idempotencia: indice unico (instance_id, recovered_at). Repeticao do mesmo
--     instante (race, retry) e rejeitada pelo banco; o servico a trata como
--     duplicado, sem somar duas vezes.
--   * Campos gravados: ator (user_id), timestamp, justificativa (note), motivo
--     da pausa (pause_reason), estados anterior e novo, estagio e tetos no momento
--     da recuperacao. Somente ids, codigos e numeros; sem telefone, nome ou corpo
--     de mensagem.
--   * Nenhum segredo e gravado; jamais apagar historico ou inteligencia.
--   * Recuperacao e auditoria sao transacionais e consistentes: a linha so e inserida
--     se a atualizacao da instancia for bem-sucedida (CAS por health_state); se a
--     insercao falhar (duplicado), a recuperacao e abortada.

BEGIN;

-- 1. whatsapp_number_health_recoveries: auditoria permanente --------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_number_health_recoveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NO ACTION: apagar o numero nao apaga o historico de auditoria.
  instance_id          uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  -- Gestor que autorizou a recuperacao.
  -- auth.users: o repositorio nao tem public.users. O ator e o mesmo id de
  -- organization_members.user_id (sessao). Nao renomear este arquivo.
  actor_user_id        uuid NOT NULL REFERENCES auth.users(id),
  -- Justificativa fornecida pelo gestor (minimo 10 caracteres validado no servico).
  note                 text NOT NULL,
  -- Estado anterior (paused ou review).
  previous_state       text NOT NULL,
  -- Estado novo apos recuperacao (warming).
  new_state            text NOT NULL,
  -- Motivo da pausa que levou a este bloqueio.
  pause_reason         text,
  -- Estagio da rampa no momento da recuperacao (preservado).
  ramp_stage           integer NOT NULL,
  -- Tetos no momento da recuperacao (preservados).
  new_contacts_cap     integer NOT NULL,
  total_cap            integer NOT NULL,
  -- Token de idempotencia gerado pelo cliente (UUID v4). Chave de idempotencia.
  idempotency_token    uuid NOT NULL,
  -- Instante da recuperacao autorizada.
  recovered_at         timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_number_health_recoveries_previous_state_chk
    CHECK (previous_state IN ('paused', 'review')),
  CONSTRAINT whatsapp_number_health_recoveries_new_state_chk
    CHECK (new_state = 'warming'),
  CONSTRAINT whatsapp_number_health_recoveries_note_chk
    CHECK (char_length(btrim(note)) >= 10),
  CONSTRAINT whatsapp_number_health_recoveries_caps_chk
    CHECK (
      ramp_stage BETWEEN 0 AND 20
      AND new_contacts_cap BETWEEN 0 AND 1000
      AND total_cap BETWEEN 0 AND 1000
      AND new_contacts_cap <= total_cap
    )
);

-- Idempotencia por ciclo de recuperacao: token unico gerado pelo cliente,
-- validado uma unica vez. Permite multiplas recuperacoes futuras da mesma instancia.
-- Token deve ser UUID v4 gerado pelo cliente a cada operacao.
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_number_health_recoveries_idempotency
  ON public.whatsapp_number_health_recoveries (org_id, idempotency_token);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_health_recoveries_org
  ON public.whatsapp_number_health_recoveries (org_id, recovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_health_recoveries_actor
  ON public.whatsapp_number_health_recoveries (actor_user_id, recovered_at DESC);

ALTER TABLE public.whatsapp_number_health_recoveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_number_health_recoveries_org_select ON public.whatsapp_number_health_recoveries;
CREATE POLICY whatsapp_number_health_recoveries_org_select ON public.whatsapp_number_health_recoveries
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- Append-only: permite apenas o DELETE em cascata de organizacao, instancia ou ator.
-- reject_append_only_mutation vem do PR05 (20261107150000).
DROP TRIGGER IF EXISTS whatsapp_number_health_recoveries_append_only ON public.whatsapp_number_health_recoveries;
CREATE TRIGGER whatsapp_number_health_recoveries_append_only
  BEFORE UPDATE OR DELETE ON public.whatsapp_number_health_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

-- Sem DELETE para ninguem. Escrita so service_role.
REVOKE ALL ON public.whatsapp_number_health_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_number_health_recoveries TO authenticated;
GRANT SELECT, INSERT ON public.whatsapp_number_health_recoveries TO service_role;

-- 2. RPC transacional: recuperacao + auditoria atomica ---------------------------
-- Executa UPDATE da instancia, liberacao do freio da fila e INSERT de auditoria
-- em uma UNICA transacao. Rollback automatico em caso de falha.
CREATE OR REPLACE FUNCTION public.authorize_number_recovery_with_audit(
  p_org_id               uuid,
  p_instance_id          uuid,
  p_actor_user_id        uuid,
  p_note                 text,
  p_idempotency_token    uuid,
  p_recovered_at         timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_inst RECORD;
  v_window_date date;
  v_audit_id uuid;
BEGIN
  -- 1. Validacao: instancia existe e pertence a org
  SELECT id, org_id, status, health_state, health_pause_reason,
         health_ramp_stage, health_new_contacts_daily_cap, health_total_daily_cap
  INTO v_inst
  FROM public.whatsapp_instances
  WHERE id = p_instance_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- 2. Validacao: estado bloqueado
  IF v_inst.health_state NOT IN ('paused', 'review') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_blocked');
  END IF;

  -- 3. Validacao: WhatsApp conectado
  IF v_inst.status <> 'connected' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_connected');
  END IF;

  -- 4. Janela de hoje (Sao Paulo)
  v_window_date := (p_recovered_at AT TIME ZONE 'America/Sao_Paulo')::date;

  -- 5. UPDATE instancia (CAS por health_state para prevenir concorrencia)
  UPDATE public.whatsapp_instances
  SET
    health_state = 'warming',
    health_pause_reason = NULL,
    health_state_changed_at = p_recovered_at,
    health_recovered_at = p_recovered_at,
    health_ack_window_date = v_window_date,
    health_ack_trusted_reports = COALESCE(
      (SELECT trusted_reports FROM public.whatsapp_number_health_windows 
       WHERE instance_id = p_instance_id AND window_date = v_window_date), 0),
    health_ack_restrictions = COALESCE(
      (SELECT restriction_events FROM public.whatsapp_number_health_windows 
       WHERE instance_id = p_instance_id AND window_date = v_window_date), 0),
    auto_send_consecutive_failures = 0
  WHERE id = p_instance_id 
    AND org_id = p_org_id 
    AND health_state = v_inst.health_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'state_conflict');
  END IF;

  -- 6. Libera freio da fila health (preserva pausa manual)
  UPDATE public.whatsapp_instances
  SET 
    auto_send_paused_at = NULL,
    auto_send_pause_reason = NULL,
    auto_send_next_at = NULL
  WHERE id = p_instance_id
    AND org_id = p_org_id
    AND auto_send_pause_reason LIKE 'health:%';

  -- 7. INSERT auditoria (idempotencia por token)
  INSERT INTO public.whatsapp_number_health_recoveries (
    org_id, instance_id, actor_user_id, note, previous_state, new_state,
    pause_reason, ramp_stage, new_contacts_cap, total_cap,
    idempotency_token, recovered_at
  ) VALUES (
    p_org_id, p_instance_id, p_actor_user_id, p_note, v_inst.health_state, 'warming',
    v_inst.health_pause_reason, v_inst.health_ramp_stage,
    v_inst.health_new_contacts_daily_cap, v_inst.health_total_daily_cap,
    p_idempotency_token, p_recovered_at
  )
  ON CONFLICT (org_id, idempotency_token) DO NOTHING
  RETURNING id INTO v_audit_id;

  IF v_audit_id IS NULL THEN
    -- Conflito de idempotencia: ja foi processado. Devolve sucesso.
    RETURN jsonb_build_object('success', true, 'state', 'warming', 'duplicate', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'state', 'warming', 'audit_id', v_audit_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

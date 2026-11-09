-- Endurece a auditoria de recuperacao criada em 20261108200000.
-- Nao renomeia a migration anterior. Forward-only: substitui a RPC, o vinculo
-- de idempotencia e as FKs. Nao liga flag, nao agenda cron e nao apaga historico.
--
-- Contrato:
--   * O token identifica o pedido (org, instancia, ator, nota, episodio).
--     Conflito de token e decidido ANTES de qualquer UPDATE.
--   * O episodio e a instancia mais o instante da pausa (blocked_at).
--     Nao usa o par instancia e previous_state: o mesmo numero pode pausar de novo.
--   * Retry do mesmo pedido devolve a auditoria original (replay), sem segundo
--     efeito. Pedido obsoleto (ABA) nao recupera a pausa nova.
--   * INSERT da auditoria nao usa clausula de conflito. Se a insercao falha, a transacao
--     desfaz o UPDATE da instancia e do freio.
--   * SECURITY DEFINER ignora RLS. A funcao confere gestor ativo da org, flag
--     oficial da org e estado/conexao lidos no banco. GRANT so service_role.
--   * Historico permanente: UPDATE/DELETE recusados mesmo aninhados. FKs
--     RESTRICT. Apagar org, usuario ou instancia com auditoria falha e a linha
--     permanece. Nao ha excecao de purge.

BEGIN;

ALTER TABLE public.whatsapp_number_health_recoveries
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

UPDATE public.whatsapp_number_health_recoveries
   SET blocked_at = recovered_at
 WHERE blocked_at IS NULL;

ALTER TABLE public.whatsapp_number_health_recoveries
  ALTER COLUMN blocked_at SET NOT NULL;

COMMENT ON COLUMN public.whatsapp_number_health_recoveries.blocked_at IS
  'health_state_changed_at do episodio de pausa recuperado. Identidade do ciclo, distinta de previous_state.';

ALTER TABLE public.whatsapp_number_health_recoveries
  DROP CONSTRAINT IF EXISTS whatsapp_number_health_recoveries_org_id_fkey;
ALTER TABLE public.whatsapp_number_health_recoveries
  ADD CONSTRAINT whatsapp_number_health_recoveries_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.whatsapp_number_health_recoveries
  DROP CONSTRAINT IF EXISTS whatsapp_number_health_recoveries_instance_id_fkey;
ALTER TABLE public.whatsapp_number_health_recoveries
  ADD CONSTRAINT whatsapp_number_health_recoveries_instance_id_fkey
  FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id) ON DELETE RESTRICT;

ALTER TABLE public.whatsapp_number_health_recoveries
  DROP CONSTRAINT IF EXISTS whatsapp_number_health_recoveries_actor_user_id_fkey;
ALTER TABLE public.whatsapp_number_health_recoveries
  ADD CONSTRAINT whatsapp_number_health_recoveries_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.ux_whatsapp_number_health_recoveries_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_number_health_recoveries_token
  ON public.whatsapp_number_health_recoveries (idempotency_token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_number_health_recoveries_episode
  ON public.whatsapp_number_health_recoveries (instance_id, blocked_at);

COMMENT ON TABLE public.whatsapp_number_health_recoveries IS
  'Auditoria permanente de recuperacao. UPDATE e DELETE sao recusados, inclusive em cascata. Apagar organizacao, usuario ou instancia que tenha linha aqui falha (ON DELETE RESTRICT) e o historico fica. Sem excecao de purge.';

-- O gatilho compartilhado deixa passar DELETE aninhado (pg_trigger_depth > 1).
-- Nesta tabela isso apagaria o historico junto com a organizacao. Gatilho proprio.
CREATE OR REPLACE FUNCTION public.reject_number_health_recovery_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '% e append-only (% bloqueado, inclusive cascata)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_number_health_recoveries_append_only ON public.whatsapp_number_health_recoveries;
CREATE TRIGGER whatsapp_number_health_recoveries_append_only
  BEFORE UPDATE OR DELETE ON public.whatsapp_number_health_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.reject_number_health_recovery_mutation();

REVOKE ALL ON public.whatsapp_number_health_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_number_health_recoveries TO authenticated;
GRANT SELECT, INSERT ON public.whatsapp_number_health_recoveries TO service_role;

DROP FUNCTION IF EXISTS public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz);

CREATE FUNCTION public.authorize_number_recovery_with_audit(
  p_org_id uuid,
  p_instance_id uuid,
  p_actor_user_id uuid,
  p_note text,
  p_idempotency_token uuid,
  p_recovered_at timestamptz,
  p_expected_blocked_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inst public.whatsapp_instances%ROWTYPE;
  v_existing public.whatsapp_number_health_recoveries%ROWTYPE;
  v_episode public.whatsapp_number_health_recoveries%ROWTYPE;
  v_window_date date;
  v_audit_id uuid;
  v_flag_on boolean;
  v_note text := btrim(COALESCE(p_note, ''));
BEGIN
  IF p_idempotency_token IS NULL
     OR p_recovered_at IS NULL
     OR p_expected_blocked_at IS NULL
     OR char_length(v_note) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  -- SECURITY DEFINER nao herda RLS. O ator tem de ser gestor ativo desta org.
  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_members m
     WHERE m.org_id = p_org_id
       AND m.user_id = p_actor_user_id
       AND m.role = 'manager'::public.member_role
       AND m.status = 'active'::public.member_status
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- Mesma regra de app_flags para caminho sem usuario: enabled ou org na lista.
  -- allow_user_ids nao estreita saude de numero (flag-scope.service.ts).
  SELECT (f.enabled OR p_org_id = ANY (f.allow_org_ids))
    INTO v_flag_on
    FROM public.app_flags f
   WHERE f.key = 'number_health_v1';

  IF NOT COALESCE(v_flag_on, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'flag_disabled');
  END IF;

  SELECT *
    INTO v_inst
    FROM public.whatsapp_instances
   WHERE id = p_instance_id
   FOR UPDATE;

  IF NOT FOUND OR v_inst.org_id IS DISTINCT FROM p_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Token antes de mutar. Replay so se o pedido inteiro coincide.
  SELECT *
    INTO v_existing
    FROM public.whatsapp_number_health_recoveries
   WHERE idempotency_token = p_idempotency_token;

  IF FOUND THEN
    IF v_existing.org_id = p_org_id
       AND v_existing.instance_id = p_instance_id
       AND v_existing.actor_user_id = p_actor_user_id
       AND v_existing.note = v_note
       AND v_existing.blocked_at = p_expected_blocked_at THEN
      RETURN jsonb_build_object(
        'success', true,
        'state', v_existing.new_state,
        'audit_id', v_existing.id,
        'replay', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'token_conflict');
  END IF;

  IF v_inst.health_state_changed_at IS DISTINCT FROM p_expected_blocked_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'stale_episode');
  END IF;

  IF v_inst.health_state NOT IN ('paused', 'review') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_blocked');
  END IF;

  IF v_inst.status IS DISTINCT FROM 'connected' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_connected');
  END IF;

  SELECT *
    INTO v_episode
    FROM public.whatsapp_number_health_recoveries
   WHERE instance_id = p_instance_id
     AND blocked_at = p_expected_blocked_at;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_recovered',
      'audit_id', v_episode.id
    );
  END IF;

  v_window_date := (p_recovered_at AT TIME ZONE 'America/Sao_Paulo')::date;

  UPDATE public.whatsapp_instances
     SET health_state = 'warming',
         health_pause_reason = NULL,
         health_state_changed_at = p_recovered_at,
         health_recovered_at = p_recovered_at,
         health_ack_window_date = v_window_date,
         health_ack_trusted_reports = COALESCE((
           SELECT w.trusted_reports
             FROM public.whatsapp_number_health_windows w
            WHERE w.instance_id = p_instance_id
              AND w.window_date = v_window_date
         ), 0),
         health_ack_restrictions = COALESCE((
           SELECT w.restriction_events
             FROM public.whatsapp_number_health_windows w
            WHERE w.instance_id = p_instance_id
              AND w.window_date = v_window_date
         ), 0),
         auto_send_consecutive_failures = 0
   WHERE id = p_instance_id
     AND org_id = p_org_id
     AND health_state = v_inst.health_state
     AND health_state_changed_at IS NOT DISTINCT FROM p_expected_blocked_at;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'state_conflict');
  END IF;

  UPDATE public.whatsapp_instances
     SET auto_send_paused_at = NULL,
         auto_send_pause_reason = NULL,
         auto_send_next_at = NULL
   WHERE id = p_instance_id
     AND org_id = p_org_id
     AND auto_send_pause_reason LIKE 'health:%';

  INSERT INTO public.whatsapp_number_health_recoveries (
    org_id, instance_id, actor_user_id, note, previous_state, new_state,
    pause_reason, ramp_stage, new_contacts_cap, total_cap,
    idempotency_token, recovered_at, blocked_at
  ) VALUES (
    p_org_id, p_instance_id, p_actor_user_id, v_note, v_inst.health_state, 'warming',
    v_inst.health_pause_reason, v_inst.health_ramp_stage,
    v_inst.health_new_contacts_daily_cap, v_inst.health_total_daily_cap,
    p_idempotency_token, p_recovered_at, p_expected_blocked_at
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'state', 'warming',
    'audit_id', v_audit_id,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.authorize_number_recovery_with_audit(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz) IS
  'Recuperacao atomica para warming. service_role only. Valida gestor ativo, flag da org, conexao e episodio antes de gravar. Retry do mesmo pedido faz replay.';

COMMIT;

NOTIFY pgrst, 'reload schema';

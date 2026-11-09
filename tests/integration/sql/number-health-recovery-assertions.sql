-- Assertivas contra a RPC e a tabela criadas pelas migrations do repositorio.
-- Qualquer falha levanta excecao (ON_ERROR_STOP no psql).

CREATE TABLE IF NOT EXISTS public.test_barrier (
  id integer PRIMARY KEY,
  ready boolean NOT NULL DEFAULT false
);
INSERT INTO public.test_barrier (id, ready) VALUES (1, false) ON CONFLICT (id) DO UPDATE SET ready = false;

INSERT INTO auth.users (id) VALUES
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('abababab-abab-4bab-8bab-abababababab')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (org_id, user_id, role, status) VALUES
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'manager', 'active'),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'sdr', 'active'),
  ('22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', 'manager', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'manager', 'suspended'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'manager', 'active'),
  ('abababab-abab-4bab-8bab-abababababab', '33333333-3333-4333-8333-333333333333', 'manager', 'active')
ON CONFLICT (org_id, user_id) DO NOTHING;

INSERT INTO public.app_flags (key, enabled, allow_org_ids, allow_user_ids) VALUES
  ('number_health_v1', false, ARRAY['11111111-1111-4111-8111-111111111111', 'abababab-abab-4bab-8bab-abababababab']::uuid[], '{}')
ON CONFLICT (key) DO UPDATE
  SET enabled = false,
      allow_org_ids = ARRAY['11111111-1111-4111-8111-111111111111', 'abababab-abab-4bab-8bab-abababababab']::uuid[];

INSERT INTO public.whatsapp_instances (
  id, org_id, instance_name, status, health_state, health_pause_reason, health_state_changed_at,
  health_ramp_stage, health_total_daily_cap, health_new_contacts_daily_cap,
  auto_send_paused_at, auto_send_pause_reason, auto_send_consecutive_failures
) VALUES
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'evo-main', 'connected', 'paused', 'session_disconnected', '2026-11-08 20:00:00+00', 2, 60, 30, '2026-11-08 20:00:00+00', 'health:session_disconnected', 4),
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'evo-manual', 'connected', 'paused', 'session_disconnected', '2026-11-08 20:00:00+00', 3, 80, 40, '2026-11-01 12:00:00+00', 'pausa manual da Ana', 2),
  ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'evo-disc', 'disconnected', 'paused', 'session_disconnected', '2026-11-08 20:00:00+00', 1, 40, 20, NULL, NULL, 0),
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', 'evo-warm', 'connected', 'warming', NULL, '2026-11-08 20:00:00+00', 1, 40, 20, NULL, NULL, 0),
  ('99999999-9999-4999-8999-999999999992', '22222222-2222-4222-8222-222222222222', 'evo-org2', 'connected', 'paused', 'failure_rate_high', '2026-11-08 20:00:00+00', 1, 40, 20, '2026-11-08 20:00:00+00', 'health:failure_rate_high', 1),
  ('99999999-9999-4999-8999-999999999993', '11111111-1111-4111-8111-111111111111', 'evo-conflict', 'connected', 'paused', 'restriction', '2026-11-08 21:00:00+00', 4, 70, 35, '2026-11-08 21:00:00+00', 'health:restriction', 1),
  ('99999999-9999-4999-8999-999999999994', '11111111-1111-4111-8111-111111111111', 'evo-rollback', 'connected', 'review', 'trusted_report', '2026-11-08 22:00:00+00', 5, 90, 45, '2026-11-08 22:00:00+00', 'health:trusted_report', 3),
  ('99999999-9999-4999-8999-999999999995', '11111111-1111-4111-8111-111111111111', 'evo-parallel', 'connected', 'paused', 'session_disconnected', '2026-11-08 23:00:00+00', 2, 60, 30, '2026-11-08 23:00:00+00', 'health:session_disconnected', 1),
  ('99999999-9999-4999-8999-999999999996', '11111111-1111-4111-8111-111111111111', 'evo-aba', 'connected', 'paused', 'session_disconnected', '2026-11-08 23:30:00+00', 2, 60, 30, '2026-11-08 23:30:00+00', 'health:session_disconnected', 1),
  ('99999999-9999-4999-8999-999999999997', 'abababab-abab-4bab-8bab-abababababab', 'evo-purge', 'connected', 'paused', 'session_disconnected', '2026-11-08 23:40:00+00', 1, 40, 20, '2026-11-08 23:40:00+00', 'health:session_disconnected', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.whatsapp_number_health_windows (
  org_id, instance_id, window_date, trusted_reports, restriction_events
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  '2026-11-12',
  4,
  2
) ON CONFLICT (instance_id, window_date) DO NOTHING;

DO $$
DECLARE
  v jsonb;
  v_proc record;
  v_state text;
  v_reason text;
  v_paused timestamptz;
  v_stage integer;
  v_total integer;
  v_newc integer;
  v_ack_reports integer;
  v_ack_restrictions integer;
  v_ack_date date;
  v_count integer;
  v_pause text;
  v_note text;
BEGIN
  IF has_function_privilege('anon', 'public.authorize_number_recovery_with_audit(uuid,uuid,uuid,text,uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon nao pode ter EXECUTE';
  END IF;
  IF has_function_privilege('authenticated', 'public.authorize_number_recovery_with_audit(uuid,uuid,uuid,text,uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated nao pode ter EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.authorize_number_recovery_with_audit(uuid,uuid,uuid,text,uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role precisa de EXECUTE';
  END IF;

  IF has_table_privilege('anon', 'public.whatsapp_number_health_recoveries', 'SELECT')
     OR has_table_privilege('anon', 'public.whatsapp_number_health_recoveries', 'INSERT') THEN
    RAISE EXCEPTION 'anon nao pode ler nem gravar a auditoria';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.whatsapp_number_health_recoveries', 'SELECT')
     OR has_table_privilege('authenticated', 'public.whatsapp_number_health_recoveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.whatsapp_number_health_recoveries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.whatsapp_number_health_recoveries', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated so pode SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.whatsapp_number_health_recoveries', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_number_health_recoveries', 'INSERT')
     OR has_table_privilege('service_role', 'public.whatsapp_number_health_recoveries', 'UPDATE')
     OR has_table_privilege('service_role', 'public.whatsapp_number_health_recoveries', 'DELETE') THEN
    RAISE EXCEPTION 'service_role so SELECT e INSERT';
  END IF;

  SELECT prosecdef, proconfig::text AS proconfig, proacl::text AS proacl
    INTO v_proc
    FROM pg_proc
   WHERE proname = 'authorize_number_recovery_with_audit';
  IF v_proc.prosecdef IS NOT TRUE OR v_proc.proconfig NOT LIKE '%search_path=public, pg_catalog%' THEN
    RAISE EXCEPTION 'SECURITY DEFINER ou search_path incorreto: %', v_proc.proconfig;
  END IF;
  IF v_proc.proacl IS NULL OR v_proc.proacl LIKE '{=X%' OR v_proc.proacl LIKE '%,=X%' THEN
    RAISE EXCEPTION 'PUBLIC ainda executa a RPC: %', v_proc.proacl;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'whatsapp_number_health_recoveries'
       AND indexdef ILIKE '%previous_state%'
  ) THEN
    RAISE EXCEPTION 'indice unique(instance, previous_state) nao e permitido';
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'justificativa do sdr nao vale',
    '12121212-1212-4121-8121-121212121212',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'SDR deveria ser forbidden, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'gestor suspenso nao recupera',
    '12121212-1212-4121-8121-121212121213',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'gestor suspenso deveria ser forbidden, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '22222222-2222-4222-8222-222222222222',
    '99999999-9999-4999-8999-999999999992',
    '55555555-5555-4555-8555-555555555555',
    'org fora da flag nao recupera',
    '12121212-1212-4121-8121-121212121214',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'flag_disabled' THEN
    RAISE EXCEPTION 'org2 deveria ser flag_disabled, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '88888888-8888-4888-8888-888888888888',
    '33333333-3333-4333-8333-333333333333',
    'desconectado nao recupera agora',
    '12121212-1212-4121-8121-121212121215',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'not_connected' THEN
    RAISE EXCEPTION 'desconectado deveria ser not_connected, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '99999999-9999-4999-8999-999999999991',
    '33333333-3333-4333-8333-333333333333',
    'warming nao esta bloqueado',
    '12121212-1212-4121-8121-121212121216',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'not_blocked' THEN
    RAISE EXCEPTION 'warming deveria ser not_blocked, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'pedido obsoleto de outra pausa',
    '12121212-1212-4121-8121-121212121217',
    '2026-11-12 15:00:00+00',
    '2026-11-01 00:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'stale_episode' THEN
    RAISE EXCEPTION 'ABA deveria ser stale_episode, veio %', v;
  END IF;

  SELECT health_state, health_pause_reason INTO v_state, v_reason
    FROM public.whatsapp_instances
   WHERE id = '66666666-6666-4666-8666-666666666666';
  IF v_state IS DISTINCT FROM 'paused' OR v_reason IS DISTINCT FROM 'session_disconnected' THEN
    RAISE EXCEPTION 'negacoes mutaram a instancia: % %', v_state, v_reason;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'reconectado e revisado pelo gestor',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'success' IS DISTINCT FROM 'true' OR v->>'state' IS DISTINCT FROM 'warming' OR v->>'replay' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'recuperacao deveria ser warming sem replay, veio %', v;
  END IF;

  SELECT health_state, health_pause_reason, auto_send_paused_at, health_ramp_stage,
         health_total_daily_cap, health_new_contacts_daily_cap,
         health_ack_trusted_reports, health_ack_restrictions, health_ack_window_date
    INTO v_state, v_reason, v_paused, v_stage, v_total, v_newc, v_ack_reports, v_ack_restrictions, v_ack_date
    FROM public.whatsapp_instances
   WHERE id = '66666666-6666-4666-8666-666666666666';
  IF v_state IS DISTINCT FROM 'warming'
     OR v_reason IS NOT NULL
     OR v_paused IS NOT NULL
     OR v_stage IS DISTINCT FROM 2
     OR v_total IS DISTINCT FROM 60
     OR v_newc IS DISTINCT FROM 30
     OR v_ack_reports IS DISTINCT FROM 4
     OR v_ack_restrictions IS DISTINCT FROM 2
     OR v_ack_date IS DISTINCT FROM DATE '2026-11-12' THEN
    RAISE EXCEPTION 'estado apos recuperacao inesperado: % % % % % % % % %',
      v_state, v_reason, v_paused, v_stage, v_total, v_newc, v_ack_reports, v_ack_restrictions, v_ack_date;
  END IF;

  SELECT pause_reason, note, new_state, ramp_stage, total_cap, new_contacts_cap
    INTO v_pause, v_note, v_state, v_stage, v_total, v_newc
    FROM public.whatsapp_number_health_recoveries
   WHERE id = (v->>'audit_id')::uuid;
  IF v_pause IS DISTINCT FROM 'session_disconnected'
     OR v_note IS DISTINCT FROM 'reconectado e revisado pelo gestor'
     OR v_state IS DISTINCT FROM 'warming'
     OR v_stage IS DISTINCT FROM 2
     OR v_total IS DISTINCT FROM 60
     OR v_newc IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'auditoria nao gravou o motivo real: % %', v_pause, v_note;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'reconectado e revisado pelo gestor',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 16:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'replay' IS DISTINCT FROM 'true' OR v->>'state' IS DISTINCT FROM 'warming' THEN
    RAISE EXCEPTION 'retry deveria ser replay, veio %', v;
  END IF;
  SELECT count(*) INTO v_count FROM public.whatsapp_number_health_recoveries
   WHERE instance_id = '66666666-6666-4666-8666-666666666666';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'retry criou auditoria extra: %', v_count;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '99999999-9999-4999-8999-999999999993',
    '33333333-3333-4333-8333-333333333333',
    'outro pedido com token alheio',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 16:00:00+00',
    '2026-11-08 21:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'token_conflict' THEN
    RAISE EXCEPTION 'token em outra instancia deveria conflitar, veio %', v;
  END IF;
  SELECT health_state INTO v_state FROM public.whatsapp_instances
   WHERE id = '99999999-9999-4999-8999-999999999993';
  IF v_state IS DISTINCT FROM 'paused' THEN
    RAISE EXCEPTION 'conflito de token mutou a outra instancia: %', v_state;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'nota diferente no mesmo token',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 16:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'token_conflict' THEN
    RAISE EXCEPTION 'token com outra nota deveria conflitar, veio %', v;
  END IF;

  UPDATE public.app_flags
     SET allow_org_ids = allow_org_ids || ARRAY['22222222-2222-4222-8222-222222222222']::uuid[]
   WHERE key = 'number_health_v1';
  v := public.authorize_number_recovery_with_audit(
    '22222222-2222-4222-8222-222222222222',
    '99999999-9999-4999-8999-999999999992',
    '55555555-5555-4555-8555-555555555555',
    'token da org1 na org2',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 16:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'token_conflict' THEN
    RAISE EXCEPTION 'token em outra org deveria conflitar, veio %', v;
  END IF;
  SELECT health_state INTO v_state FROM public.whatsapp_instances
   WHERE id = '99999999-9999-4999-8999-999999999992';
  IF v_state IS DISTINCT FROM 'paused' THEN
    RAISE EXCEPTION 'conflito entre orgs mutou a instancia: %', v_state;
  END IF;
  UPDATE public.app_flags
     SET allow_org_ids = array_remove(allow_org_ids, '22222222-2222-4222-8222-222222222222'::uuid)
   WHERE key = 'number_health_v1';

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'reconectado e revisado pelo gestor',
    '12121212-1212-4121-8121-121212121218',
    '2026-11-12 16:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'error' IS DISTINCT FROM 'token_conflict' THEN
    RAISE EXCEPTION 'token com outro ator deveria conflitar, veio %', v;
  END IF;

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777777',
    '33333333-3333-4333-8333-333333333333',
    'preserva pausa manual da fila',
    '13131313-1313-4131-8131-131313131313',
    '2026-11-12 15:00:00+00',
    '2026-11-08 20:00:00+00'
  );
  IF v->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'pausa manual deveria recuperar a saude, veio %', v;
  END IF;
  SELECT auto_send_paused_at, auto_send_pause_reason, health_ramp_stage, health_total_daily_cap, health_new_contacts_daily_cap, health_state
    INTO v_paused, v_reason, v_stage, v_total, v_newc, v_state
    FROM public.whatsapp_instances
   WHERE id = '77777777-7777-4777-8777-777777777777';
  IF v_state IS DISTINCT FROM 'warming'
     OR v_paused IS DISTINCT FROM '2026-11-01 12:00:00+00'::timestamptz
     OR v_reason IS DISTINCT FROM 'pausa manual da Ana'
     OR v_stage IS DISTINCT FROM 3
     OR v_total IS DISTINCT FROM 80
     OR v_newc IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION 'pausa manual ou tetos alterados: % % %', v_state, v_paused, v_reason;
  END IF;

  UPDATE public.whatsapp_instances
     SET health_state = 'paused',
         health_pause_reason = 'failure_rate_high',
         health_state_changed_at = '2026-11-09 11:00:00+00',
         auto_send_paused_at = '2026-11-09 11:00:00+00',
         auto_send_pause_reason = 'health:failure_rate_high'
   WHERE id = '66666666-6666-4666-8666-666666666666';

  v := public.authorize_number_recovery_with_audit(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'segundo ciclo legitimo apos nova pausa',
    '14141414-1414-4141-8141-141414141414',
    '2026-11-12 18:00:00+00',
    '2026-11-09 11:00:00+00'
  );
  IF v->>'success' IS DISTINCT FROM 'true' OR v->>'replay' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'segundo ciclo deveria gravar, veio %', v;
  END IF;
  SELECT count(*) INTO v_count FROM public.whatsapp_number_health_recoveries
   WHERE instance_id = '66666666-6666-4666-8666-666666666666';
  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'dois ciclos deveriam gerar duas linhas, veio %', v_count;
  END IF;
  SELECT pause_reason INTO v_pause FROM public.whatsapp_number_health_recoveries
   WHERE id = (v->>'audit_id')::uuid;
  IF v_pause IS DISTINCT FROM 'failure_rate_high' THEN
    RAISE EXCEPTION 'segundo ciclo gravou motivo errado: %', v_pause;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fail_number_health_recovery_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced audit insert failure';
END;
$$;

CREATE TRIGGER zz_fail_recovery_insert
  BEFORE INSERT ON public.whatsapp_number_health_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.fail_number_health_recovery_insert();

DO $$
DECLARE
  v_state text;
  v_reason text;
  v_paused timestamptz;
  v_failures integer;
  v_count integer;
BEGIN
  BEGIN
    PERFORM public.authorize_number_recovery_with_audit(
      '11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999994',
      '33333333-3333-4333-8333-333333333333',
      'falha de auditoria precisa desfazer',
      '15151515-1515-4151-8151-151515151515',
      '2026-11-12 15:00:00+00',
      '2026-11-08 22:00:00+00'
    );
    RAISE EXCEPTION 'insert da auditoria deveria ter falhado';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%forced audit insert failure%' THEN
        RAISE;
      END IF;
  END;

  SELECT health_state, health_pause_reason, auto_send_paused_at, auto_send_consecutive_failures
    INTO v_state, v_reason, v_paused, v_failures
    FROM public.whatsapp_instances
   WHERE id = '99999999-9999-4999-8999-999999999994';
  IF v_state IS DISTINCT FROM 'review'
     OR v_reason IS DISTINCT FROM 'trusted_report'
     OR v_paused IS DISTINCT FROM '2026-11-08 22:00:00+00'::timestamptz
     OR v_failures IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'rollback nao devolveu estado/freio: % % % %', v_state, v_reason, v_paused, v_failures;
  END IF;
  SELECT count(*) INTO v_count FROM public.whatsapp_number_health_recoveries
   WHERE instance_id = '99999999-9999-4999-8999-999999999994';
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'auditoria parcial permaneceu: %', v_count;
  END IF;
END $$;

DROP TRIGGER zz_fail_recovery_insert ON public.whatsapp_number_health_recoveries;
DROP FUNCTION public.fail_number_health_recovery_insert();

DO $$
DECLARE
  v_visible integer;
BEGIN
  BEGIN
    UPDATE public.whatsapp_number_health_recoveries SET note = note || ' x';
    RAISE EXCEPTION 'update da auditoria deveria falhar';
  EXCEPTION
    WHEN restrict_violation THEN
      NULL;
  END;

  BEGIN
    DELETE FROM public.whatsapp_number_health_recoveries;
    RAISE EXCEPTION 'delete da auditoria deveria falhar';
  EXCEPTION
    WHEN restrict_violation THEN
      NULL;
  END;

  BEGIN
    DELETE FROM public.organizations WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'delete da org com auditoria deveria falhar';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;

  BEGIN
    DELETE FROM auth.users WHERE id = '33333333-3333-4333-8333-333333333333';
    RAISE EXCEPTION 'delete do ator com auditoria deveria falhar';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;

  BEGIN
    DELETE FROM public.whatsapp_instances WHERE id = '66666666-6666-4666-8666-666666666666';
    RAISE EXCEPTION 'delete da instancia com auditoria deveria falhar';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;
END $$;

-- Prova que o gatilho recusa DELETE aninhado, nao so o RESTRICT da FK.
DO $$
DECLARE
  v jsonb;
  v_count integer;
BEGIN
  v := public.authorize_number_recovery_with_audit(
    'abababab-abab-4bab-8bab-abababababab',
    '99999999-9999-4999-8999-999999999997',
    '33333333-3333-4333-8333-333333333333',
    'linha usada para testar cascata',
    '16161616-1616-4161-8161-161616161616',
    '2026-11-12 15:00:00+00',
    '2026-11-08 23:40:00+00'
  );
  IF v->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'recuperacao de purge falhou: %', v;
  END IF;

  ALTER TABLE public.whatsapp_number_health_recoveries
    DROP CONSTRAINT whatsapp_number_health_recoveries_org_id_fkey;
  ALTER TABLE public.whatsapp_number_health_recoveries
    ADD CONSTRAINT whatsapp_number_health_recoveries_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  ALTER TABLE public.whatsapp_number_health_recoveries
    DROP CONSTRAINT whatsapp_number_health_recoveries_instance_id_fkey;
  ALTER TABLE public.whatsapp_number_health_recoveries
    ADD CONSTRAINT whatsapp_number_health_recoveries_instance_id_fkey
    FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE;

  BEGIN
    DELETE FROM public.organizations WHERE id = 'abababab-abab-4bab-8bab-abababababab';
    RAISE EXCEPTION 'cascata nao pode apagar auditoria';
  EXCEPTION
    WHEN restrict_violation THEN
      NULL;
  END;

  SELECT count(*) INTO v_count
    FROM public.whatsapp_number_health_recoveries
   WHERE instance_id = '99999999-9999-4999-8999-999999999997';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'cascata apagou ou nao gravou a auditoria: %', v_count;
  END IF;

  ALTER TABLE public.whatsapp_number_health_recoveries
    DROP CONSTRAINT whatsapp_number_health_recoveries_org_id_fkey;
  ALTER TABLE public.whatsapp_number_health_recoveries
    ADD CONSTRAINT whatsapp_number_health_recoveries_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
  ALTER TABLE public.whatsapp_number_health_recoveries
    DROP CONSTRAINT whatsapp_number_health_recoveries_instance_id_fkey;
  ALTER TABLE public.whatsapp_number_health_recoveries
    ADD CONSTRAINT whatsapp_number_health_recoveries_instance_id_fkey
    FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE
  v_own integer;
  v_other integer;
BEGIN
  PERFORM set_config('app.user_org_id', '11111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_own FROM public.whatsapp_number_health_recoveries;
  EXECUTE 'RESET ROLE';
  IF v_own < 1 THEN
    RAISE EXCEPTION 'authenticated da org1 deveria ver a propria auditoria, viu %', v_own;
  END IF;

  PERFORM set_config('app.user_org_id', '22222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_other FROM public.whatsapp_number_health_recoveries;
  EXECUTE 'RESET ROLE';
  IF v_other IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'authenticated da org2 viu auditoria alheia: %', v_other;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.whatsapp_number_health_recoveries (
      org_id, instance_id, actor_user_id, note, previous_state, new_state,
      pause_reason, ramp_stage, new_contacts_cap, total_cap, idempotency_token, recovered_at, blocked_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'insert direto nao pode',
      'paused', 'warming', NULL, 0, 10, 20,
      '17171717-1717-4171-8171-171717171717',
      now(), now()
    );
    RAISE EXCEPTION 'authenticated nao pode inserir auditoria';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  EXECUTE 'RESET ROLE';
END $$;

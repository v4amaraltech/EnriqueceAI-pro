-- Documentação: aplicada em produção via MCP como versão 20261031161219 (o arquivo original tinha outro timestamp e nunca entrou no repositório).
-- Conteúdo conferido contra supabase_migrations.schema_migrations em 15/11/2026. NÃO reaplicar.
-- BDR — "E-mail primeiro" também na cadência mista v3 (31/10/2026)
--
-- A regra de 15/10 (p_exige_abertura_email) só age em cadências de contato VINCULADAS a uma
-- cadência de e-mail irmã (bdr_cadence_links). A cadência v3 "BDR IA — Indústrias de Alimentos
-- (v3 — ligação, e-mail e WhatsApp)" (78aa84ca…) tem os e-mails DENTRO dela e não tem vínculo:
-- a Ana ligou para todo mundo em outubro (335 ligações, 17 pessoas certas, 0 reuniões), inclusive
-- para quem nunca abriu e-mail nenhum.
--
-- Cadência mista = vínculo consigo mesma (phone_cadence_id = email_cadence_id). Para ela:
--   * o passo de ligação vencido de um lead SEM e-mail aberto/clicado/respondido na janela é
--     PULADO (não adiado): a inscrição avança direto para o próximo passo que não é ligação
--     (e-mail ou WhatsApp), que vence pelo próprio delay a partir de agora, como se a ligação
--     tivesse acontecido. Os passos pulados ficam na timeline (step_skipped / sem_abertura_de_email).
--     Sem passo seguinte que não seja ligação, a inscrição termina (cadence_ended_phone_no_email_open).
--   * quem abriu e-mail na janela é reservado normalmente (mesma condição de antes).
-- Cadências vinculadas a outra cadência de e-mail (v2) seguem como em 15/10: adia enquanto a de
-- e-mail roda, encerra quando ela acaba.
--
-- Correção de passagem: o bloco "e-mail primeiro" passa a olhar só inscrições cujo passo atual é do
-- canal pedido (p_channel). Antes não filtrava — numa cadência só de ligação dava no mesmo; numa
-- mista adiaria/pularia passos de e-mail.
--
-- O trigger bdr_enroll_email_pair ignora vínculo consigo mesmo (não há segunda cadência a inscrever).
BEGIN;

-- 1. Trigger de inscrição dupla (igual a 20261015120000): nada a fazer quando a cadência de
--    e-mail é a própria. (O AFTER INSERT já enxergava a própria linha e não duplicava; a guarda
--    deixa isso explícito.)
CREATE OR REPLACE FUNCTION public.bdr_enroll_email_pair()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email uuid;
BEGIN
  SELECT email_cadence_id INTO v_email FROM public.bdr_cadence_links WHERE phone_cadence_id = NEW.cadence_id;
  IF v_email IS NULL OR v_email = NEW.cadence_id THEN
    RETURN NEW; -- sem vínculo, ou cadência mista (os e-mails estão nela mesma)
  END IF;
  IF EXISTS (SELECT 1 FROM public.cadence_enrollments e WHERE e.lead_id = NEW.lead_id AND e.cadence_id = v_email) THEN
    RETURN NEW; -- já passou (ou está passando) pela cadência de e-mail
  END IF;
  INSERT INTO public.cadence_enrollments (cadence_id, lead_id, org_id, current_step, status, enrolled_by)
  VALUES (v_email, NEW.lead_id, NEW.org_id, 1, 'active', NEW.enrolled_by);
  INSERT INTO public.interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, performed_by, metadata)
  VALUES (NEW.org_id, NEW.lead_id, v_email,
          (SELECT id FROM public.cadence_steps WHERE cadence_id = v_email AND step_order = 1),
          'system', 'sent', 'Inscrito automaticamente na cadência de e-mail vinculada (e-mail primeiro).', NEW.enrolled_by,
          jsonb_build_object('system_event', 'bdr_email_pair_enrolled', 'phone_cadence_id', NEW.cadence_id, 'email_cadence_id', v_email));
  RETURN NEW;
END;
$$;

-- 2. claim_due_steps: igual a 20261016120000, com a cadência mista no bloco "e-mail primeiro"
CREATE OR REPLACE FUNCTION public.claim_due_steps(
  p_org_id                uuid,
  p_cadence_ids           uuid[],
  p_channel               text    DEFAULT 'phone',
  p_limit                 integer DEFAULT 10,
  p_lease_minutes         integer DEFAULT 15,
  p_owner                 text    DEFAULT NULL,
  p_exige_abertura_email  boolean DEFAULT false
)
RETURNS TABLE (
  execution_id        uuid,
  attempt             integer,
  recuperada          boolean,
  lease_until         timestamptz,
  enrollment_id       uuid,
  org_id              uuid,
  cadence_id          uuid,
  cadence_name        text,
  step_id             uuid,
  step_order          integer,
  channel             text,
  call_provider       text,
  activity_name       text,
  instructions        text,
  next_step_due       timestamptz,
  dono                uuid,
  lead_id             uuid,
  lead_nome           text,
  lead_empresa        text,
  lead_cargo          text,
  lead_telefone       text,
  lead_email          text,
  lead_segmento       text,
  lead_custom         jsonb,
  lead_telefone_fixo  text,
  lead_abriu_email_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r            RECORD;
  a            RECORD;
  v_limit      INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease      INTERVAL := make_interval(mins => LEAST(GREATEST(COALESCE(p_lease_minutes, 15), 1), 240));
  v_exec       cadence_step_executions%ROWTYPE;
  v_exec_id    UUID;
  v_attempt    INTEGER;
  v_recuperada BOOLEAN;
  v_amanha_9h  TIMESTAMPTZ;
  v_prox       INTEGER;
BEGIN
  IF p_org_id IS NULL OR p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 0. E-mail primeiro: passos vencidos (do canal pedido) de cadências vinculadas cujo lead não
  --    abriu e-mail na janela. Cadência mista (vínculo consigo mesma): pula as ligações até o
  --    próximo passo de outro canal. Cadência com e-mail irmã: adia (e-mail rodando) ou encerra.
  IF p_exige_abertura_email THEN
    v_amanha_9h := public.skip_weekend_brt(
      (((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1) + time '09:00') AT TIME ZONE 'America/Sao_Paulo');
    FOR a IN
      SELECT ce.id, ce.lead_id, ce.org_id, ce.cadence_id, ce.current_step, lk.email_cadence_id,
             lk.janela_abertura_dias,
             (lk.email_cadence_id = ce.cadence_id) AS mista,
             cs0.id AS step_id,
             EXISTS (SELECT 1 FROM cadence_enrollments e
                      WHERE e.lead_id = ce.lead_id AND e.cadence_id = lk.email_cadence_id AND e.status = 'active') AS email_ativo
        FROM cadence_enrollments ce
        JOIN bdr_cadence_links lk ON lk.phone_cadence_id = ce.cadence_id
        JOIN cadence_steps cs0 ON cs0.cadence_id = ce.cadence_id AND cs0.step_order = ce.current_step
                              AND cs0.channel::text = p_channel
       WHERE ce.org_id = p_org_id
         AND ce.cadence_id = ANY (p_cadence_ids)
         AND ce.status = 'active'
         AND ce.next_step_due IS NOT NULL
         AND ce.next_step_due <= now()
         AND (ce.lease_until IS NULL OR ce.lease_until < now())
         AND COALESCE(public.bdr_ultimo_engajamento_email(ce.lead_id), '-infinity'::timestamptz)
               < now() - make_interval(days => lk.janela_abertura_dias)
         FOR UPDATE OF ce SKIP LOCKED
    LOOP
      IF a.mista THEN
        SELECT MIN(cs.step_order) INTO v_prox
          FROM cadence_steps cs
         WHERE cs.cadence_id = a.cadence_id AND cs.step_order > a.current_step
           AND cs.channel::text <> p_channel;

        INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, metadata)
        SELECT a.org_id, a.lead_id, a.cadence_id, s.id, 'system', 'sent',
               'Ligação ' || s.step_order || ' pulada: o lead não abriu nenhum e-mail nos últimos '
                 || a.janela_abertura_dias || ' dias (e-mail primeiro).',
               jsonb_build_object('system_event', 'step_skipped', 'reason', 'sem_abertura_de_email',
                                  'skipped_step_order', s.step_order, 'enrollment_id', a.id,
                                  'next_step_order', v_prox)
          FROM cadence_steps s
         WHERE s.cadence_id = a.cadence_id AND s.channel::text = p_channel
           AND s.step_order >= a.current_step
           AND (v_prox IS NULL OR s.step_order < v_prox);

        IF v_prox IS NOT NULL THEN
          -- Trigger calculate_next_step_due recalcula o vencimento pelo delay do passo novo.
          UPDATE cadence_enrollments
             SET current_step = v_prox, snooze_count = 0,
                 execution_id = NULL, lease_owner = NULL, lease_until = NULL
           WHERE id = a.id;
        ELSE
          UPDATE cadence_enrollments SET status = 'completed', completed_at = now() WHERE id = a.id;
          INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, metadata)
          VALUES (a.org_id, a.lead_id, a.cadence_id, a.step_id, 'system', 'sent',
                  'Cadência encerrada: o lead não abriu nenhum e-mail e não restam passos além das ligações. Sem ligação.',
                  jsonb_build_object('system_event', 'cadence_ended_phone_no_email_open', 'reason', 'sem_abertura_de_email',
                                     'enrollment_id', a.id, 'email_cadence_id', a.email_cadence_id));
        END IF;
      ELSIF a.email_ativo THEN
        UPDATE cadence_enrollments
           SET next_step_due = v_amanha_9h, snooze_count = COALESCE(snooze_count, 0) + 1
         WHERE id = a.id;
      ELSE
        UPDATE cadence_enrollments SET status = 'completed', completed_at = now() WHERE id = a.id;
        INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, metadata)
        VALUES (a.org_id, a.lead_id, a.cadence_id, a.step_id, 'system', 'sent',
                'Cadência de contato encerrada: o lead não abriu nenhum e-mail e a cadência de e-mail terminou. Sem ligação.',
                jsonb_build_object('system_event', 'cadence_ended_phone_no_email_open', 'reason', 'sem_abertura_de_email',
                                   'enrollment_id', a.id, 'email_cadence_id', a.email_cadence_id));
      END IF;
    END LOOP;
  END IF;

  FOR r IN
    SELECT ce.id            AS enrollment_id,
           ce.org_id,
           ce.cadence_id,
           c.name           AS cadence_name,
           cs.id            AS step_id,
           cs.step_order,
           cs.channel::text AS channel,
           cs.call_provider,
           cs.activity_name,
           cs.instructions,
           ce.next_step_due,
           ce.execution_id  AS current_execution_id,
           COALESCE(ce.pending_assigned_to, l.assigned_to, c.created_by) AS dono,
           l.id             AS lead_id,
           NULLIF(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), '') AS lead_nome,
           COALESCE(NULLIF(l.nome_fantasia, ''), l.razao_social) AS lead_empresa,
           l.job_title      AS lead_cargo,
           l.telefone       AS lead_telefone,
           l.email          AS lead_email,
           l.segmento       AS lead_segmento,
           l.custom_field_values AS lead_custom,
           (SELECT p ->> 'numero' FROM jsonb_array_elements(COALESCE(l.phones, '[]'::jsonb)) p
             WHERE p ->> 'tipo' = 'fixo' AND NULLIF(TRIM(p ->> 'numero'), '') IS NOT NULL LIMIT 1) AS lead_telefone_fixo,
           public.bdr_ultimo_engajamento_email(l.id) AS lead_abriu_email_em
      FROM cadence_enrollments ce
      JOIN cadences c        ON c.id = ce.cadence_id AND c.status = 'active' AND c.deleted_at IS NULL
      JOIN cadence_steps cs  ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
      JOIN leads l           ON l.id = ce.lead_id AND l.deleted_at IS NULL AND l.archived_at IS NULL
     WHERE ce.org_id = p_org_id
       AND ce.cadence_id = ANY (p_cadence_ids)
       AND ce.status = 'active'
       AND ce.next_step_due IS NOT NULL
       AND ce.next_step_due <= now()
       AND cs.channel::text = p_channel
       AND (ce.lease_until IS NULL OR ce.lease_until < now())
       AND NOT EXISTS (
             SELECT 1 FROM contact_holds h
              WHERE h.lead_id = ce.lead_id AND h.tipo IN ('prospeccao', 'total'))
       AND (
             NOT p_exige_abertura_email
             OR NOT EXISTS (SELECT 1 FROM bdr_cadence_links lk WHERE lk.phone_cadence_id = ce.cadence_id)
             OR EXISTS (
                  SELECT 1 FROM bdr_cadence_links lk
                   WHERE lk.phone_cadence_id = ce.cadence_id
                     AND public.bdr_ultimo_engajamento_email(ce.lead_id) >= now() - make_interval(days => lk.janela_abertura_dias))
           )
     ORDER BY ce.next_step_due ASC, ce.id ASC
     LIMIT v_limit
       FOR UPDATE OF ce SKIP LOCKED
  LOOP
    v_exec := NULL;
    v_recuperada := false;

    IF r.current_execution_id IS NOT NULL THEN
      SELECT * INTO v_exec FROM cadence_step_executions x
       WHERE x.execution_id = r.current_execution_id
         AND x.enrollment_id = r.enrollment_id
         AND x.step_id = r.step_id
         AND x.confirmed_at IS NULL
         AND x.released_at IS NULL;
    END IF;

    IF v_exec.execution_id IS NOT NULL THEN
      v_exec_id := v_exec.execution_id;
      v_attempt := v_exec.attempt;
      v_recuperada := true;
      UPDATE cadence_step_executions
         SET claims = claims + 1,
             last_claimed_at = now(),
             lease_owner = p_owner,
             lease_until = now() + v_lease
       WHERE cadence_step_executions.execution_id = v_exec_id;
    ELSE
      SELECT COALESCE(MAX(x.attempt), 0) + 1 INTO v_attempt
        FROM cadence_step_executions x
       WHERE x.enrollment_id = r.enrollment_id AND x.step_id = r.step_id;
      v_exec_id := public.bdr_step_execution_id(r.enrollment_id, r.step_id, v_attempt);
      INSERT INTO cadence_step_executions
        (execution_id, org_id, enrollment_id, cadence_id, step_id, step_order, channel, attempt,
         lease_owner, lease_until)
      VALUES
        (v_exec_id, r.org_id, r.enrollment_id, r.cadence_id, r.step_id, r.step_order, r.channel, v_attempt,
         p_owner, now() + v_lease);
    END IF;

    UPDATE cadence_enrollments
       SET execution_id = v_exec_id,
           lease_owner  = p_owner,
           lease_until  = now() + v_lease
     WHERE id = r.enrollment_id;

    execution_id  := v_exec_id;
    attempt       := v_attempt;
    recuperada    := v_recuperada;
    lease_until   := now() + v_lease;
    enrollment_id := r.enrollment_id;
    org_id        := r.org_id;
    cadence_id    := r.cadence_id;
    cadence_name  := r.cadence_name;
    step_id       := r.step_id;
    step_order    := r.step_order;
    channel       := r.channel;
    call_provider := r.call_provider;
    activity_name := r.activity_name;
    instructions  := r.instructions;
    next_step_due := r.next_step_due;
    dono          := r.dono;
    lead_id       := r.lead_id;
    lead_nome     := r.lead_nome;
    lead_empresa  := r.lead_empresa;
    lead_cargo    := r.lead_cargo;
    lead_telefone := r.lead_telefone;
    lead_email    := r.lead_email;
    lead_segmento := r.lead_segmento;
    lead_custom   := r.lead_custom;
    lead_telefone_fixo  := r.lead_telefone_fixo;
    lead_abriu_email_em := r.lead_abriu_email_em;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_steps(uuid, uuid[], text, integer, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_steps(uuid, uuid[], text, integer, integer, text, boolean) TO service_role;
COMMENT ON FUNCTION public.claim_due_steps(uuid, uuid[], text, integer, integer, text, boolean) IS
  'BDR-2: reserva passos vencidos com lease e execution_id determinístico. p_exige_abertura_email: em cadências vinculadas (bdr_cadence_links) só reserva leads com e-mail aberto de verdade na janela; cadência mista (vínculo consigo mesma) pula as ligações até o próximo passo de outro canal, cadência com e-mail irmã adia ou encerra. Devolve lead_telefone_fixo e lead_abriu_email_em.';

COMMIT;

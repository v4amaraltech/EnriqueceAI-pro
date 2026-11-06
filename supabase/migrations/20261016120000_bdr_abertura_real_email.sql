-- BDR — Abertura de e-mail só conta como sinal quando é de pessoa (16/10/2026).
--
-- Filtros de segurança de e-mail abrem o pixel e seguem os links segundos depois da entrega: em 90 dias,
-- 210 de 919 aberturas (23%) chegaram menos de 30 s após o envio (8 das 10 primeiras da cadência v3 em
-- 16/10). Essas aberturas liberavam a ligação do "e-mail primeiro" e contavam para o WhatsApp da Ana.
-- Além disso o rastreio só criava o registro `opened` na 1ª abertura — a do robô escondia a da pessoa.
--
-- Agora (app, src/lib/email/engajamento-real.ts) o rastreio grava no metadata do `sent` a data da 1ª
-- abertura (`aberto_real_em`) e do 1º clique (`clicado_real_em`) que chegam 2 min ou mais após o envio.
-- Aqui:
--   1. bdr_ultimo_engajamento_email(lead): última abertura/clique real ou resposta do lead;
--   2. claim_due_steps passa a usar essa função (e-mail primeiro e lead_abriu_email_em);
--   3. preenche aberto_real_em / clicado_real_em dos envios antigos a partir de opened/clicks com 2 min+.
BEGIN;

-- 1. Último engajamento real com e-mail
CREATE OR REPLACE FUNCTION public.bdr_ultimo_engajamento_email(p_lead_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT MAX(t) FROM (
    SELECT GREATEST(
             CASE WHEN i.metadata ? 'aberto_real_em' THEN (i.metadata ->> 'aberto_real_em')::timestamptz END,
             CASE WHEN i.metadata ? 'clicado_real_em' THEN (i.metadata ->> 'clicado_real_em')::timestamptz END) AS t
      FROM interactions i
     WHERE i.lead_id = p_lead_id AND i.channel = 'email' AND i.type = 'sent'
       AND (i.metadata ? 'aberto_real_em' OR i.metadata ? 'clicado_real_em')
    UNION ALL
    SELECT i.created_at
      FROM interactions i
     WHERE i.lead_id = p_lead_id AND i.channel = 'email' AND i.type = 'replied'
  ) x;
$$;
REVOKE ALL ON FUNCTION public.bdr_ultimo_engajamento_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bdr_ultimo_engajamento_email(uuid) TO service_role;
COMMENT ON FUNCTION public.bdr_ultimo_engajamento_email(uuid) IS
  'BDR: última abertura/clique de e-mail feito por pessoa (aberto_real_em/clicado_real_em do sent, 2 min+ após o envio) ou resposta do lead.';

-- 2. claim_due_steps (igual a 20261015120000, trocando as três leituras de opened/clicked/replied)
CREATE OR REPLACE FUNCTION public.claim_due_steps(
  p_org_id                uuid,
  p_cadence_ids           uuid[],
  p_channel               text    DEFAULT 'phone',
  p_limit                 integer DEFAULT 10,
  p_lease_minutes         integer DEFAULT 15,
  p_owner                 text    DEFAULT NULL,
  p_exige_abertura_email  boolean DEFAULT false
)
RETURNS TABLE(
  execution_id uuid, attempt integer, recuperada boolean, lease_until timestamptz,
  enrollment_id uuid, org_id uuid, cadence_id uuid, cadence_name text,
  step_id uuid, step_order integer, channel text, call_provider text, activity_name text, instructions text,
  next_step_due timestamptz, dono uuid,
  lead_id uuid, lead_nome text, lead_empresa text, lead_cargo text, lead_telefone text, lead_email text,
  lead_segmento text, lead_custom jsonb,
  lead_telefone_fixo text, lead_abriu_email_em timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
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
BEGIN
  IF p_org_id IS NULL OR p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 0. E-mail primeiro: passos vencidos de cadências vinculadas cujo lead não abriu
  --    e-mail na janela são adiados (e-mail ainda rodando) ou encerrados (e-mail acabou).
  IF p_exige_abertura_email THEN
    v_amanha_9h := public.skip_weekend_brt(
      (((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1) + time '09:00') AT TIME ZONE 'America/Sao_Paulo');
    FOR a IN
      SELECT ce.id, ce.lead_id, ce.org_id, ce.cadence_id, ce.current_step, lk.email_cadence_id,
             (SELECT cs.id FROM cadence_steps cs WHERE cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step) AS step_id,
             EXISTS (SELECT 1 FROM cadence_enrollments e
                      WHERE e.lead_id = ce.lead_id AND e.cadence_id = lk.email_cadence_id AND e.status = 'active') AS email_ativo
        FROM cadence_enrollments ce
        JOIN bdr_cadence_links lk ON lk.phone_cadence_id = ce.cadence_id
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
      IF a.email_ativo THEN
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
  'BDR-2: reserva passos vencidos com lease e execution_id determinístico. p_exige_abertura_email: em cadências vinculadas (bdr_cadence_links) só reserva leads com e-mail aberto de verdade (bdr_ultimo_engajamento_email: abertura/clique depois do corte de 2 min, ou resposta) na janela; adia ou encerra os demais. Devolve lead_telefone_fixo e lead_abriu_email_em.';

-- 3. Histórico: data da 1ª abertura e do 1º clique reais dos envios antigos
UPDATE interactions s
   SET metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object('aberto_real_em', o.primeira)
  FROM (SELECT se.id AS sent_id, MIN(op.created_at) AS primeira
          FROM interactions op
          JOIN interactions se ON se.id::text = op.metadata ->> 'sent_interaction_id'
         WHERE op.channel = 'email' AND op.type = 'opened'
           AND op.created_at >= se.created_at + interval '2 minutes'
         GROUP BY se.id) o
 WHERE s.id = o.sent_id AND s.type = 'sent' AND NOT (COALESCE(s.metadata, '{}'::jsonb) ? 'aberto_real_em');

UPDATE interactions s
   SET metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object('clicado_real_em', c.primeiro)
  FROM (SELECT se.id, MIN((ck ->> 'clicked_at')::timestamptz) AS primeiro
          FROM interactions se, jsonb_array_elements(se.metadata -> 'clicks') ck
         WHERE se.channel = 'email' AND se.type = 'sent' AND jsonb_typeof(se.metadata -> 'clicks') = 'array'
           AND ck ->> 'clicked_at' ~ '^\d{4}-\d{2}-\d{2}T'
           AND (ck ->> 'clicked_at')::timestamptz >= se.created_at + interval '2 minutes'
         GROUP BY se.id) c
 WHERE s.id = c.id AND NOT (COALESCE(s.metadata, '{}'::jsonb) ? 'clicado_real_em');

COMMIT;

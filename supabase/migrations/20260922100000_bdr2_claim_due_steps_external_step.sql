-- BDR-2 — Telefonia confiável, lado Enriquece (plano docs/bdr/plano-bdr-ia.md do V4 Call, §7.2 e §7.5)
--
-- Por quê: os passos de telefone da cadência "(contato)" ficavam como atividade
-- pendente do SDR — ninguém ligava nem dava baixa. Aqui o n8n passa a:
--   1. reservar passos vencidos com `claim_due_steps` (FOR UPDATE SKIP LOCKED +
--      lease), recebendo um `execution_id` PERSISTENTE por (inscrição, passo,
--      tentativa comercial). Recuperação técnica (lease expirou, n8n caiu)
--      devolve o MESMO id — o V4 Call reconhece o intent e não redisca.
--   2. confirmar o passo com `confirm_external_step`, idempotente por
--      `event_id` (outbox do V4 Call) e por `execution_id`, que grava a
--      interaction e avança a inscrição via `advance_enrollment_after_step`.
--
-- Nova tentativa comercial (attempt+1) só por decisão explícita:
-- `release_step_claim(..., p_nova_tentativa => true)`. Nunca automática.
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ── Colunas de reserva na inscrição ──────────────────────────────────────────
ALTER TABLE cadence_enrollments
  ADD COLUMN IF NOT EXISTS execution_id UUID,
  ADD COLUMN IF NOT EXISTS lease_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_owner  TEXT;

COMMENT ON COLUMN cadence_enrollments.execution_id IS
  'BDR-2: execução em curso do passo atual (cadence_step_executions). Zera ao confirmar/avançar.';
COMMENT ON COLUMN cadence_enrollments.lease_until IS
  'BDR-2: até quando o executor (n8n) detém o passo. Expirado → outro executor pode reservar (mesmo execution_id).';

CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_claim
  ON cadence_enrollments (cadence_id, next_step_due)
  WHERE status = 'active' AND next_step_due IS NOT NULL;

-- ── Histórico de execuções de passo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cadence_step_executions (
  execution_id        UUID PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrollment_id       UUID NOT NULL REFERENCES cadence_enrollments(id) ON DELETE CASCADE,
  cadence_id          UUID NOT NULL,
  step_id             UUID NOT NULL,
  step_order          INTEGER NOT NULL,
  channel             TEXT NOT NULL,
  attempt             INTEGER NOT NULL DEFAULT 1,       -- tentativa COMERCIAL
  claims              INTEGER NOT NULL DEFAULT 1,       -- reservas técnicas (1 = primeira; >1 = recuperação)
  lease_owner         TEXT,
  lease_until         TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at         TIMESTAMPTZ,
  release_motivo      TEXT,
  confirmed_at        TIMESTAMPTZ,
  confirmed_event_id  UUID,
  evento              TEXT,
  call_sid            TEXT,
  interaction_id      UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_cadence_step_executions_enrollment ON cadence_step_executions (enrollment_id, step_id);
CREATE INDEX IF NOT EXISTS idx_cadence_step_executions_org_open
  ON cadence_step_executions (org_id, claimed_at) WHERE confirmed_at IS NULL;
ALTER TABLE cadence_step_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cadence_step_executions_org ON cadence_step_executions;
CREATE POLICY cadence_step_executions_org ON cadence_step_executions FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());
DROP TRIGGER IF EXISTS set_updated_at ON cadence_step_executions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cadence_step_executions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Eventos externos recebidos (idempotência por event_id) ───────────────────
CREATE TABLE IF NOT EXISTS external_step_events (
  event_id       UUID PRIMARY KEY,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  execution_id   UUID,
  enrollment_id  UUID,
  evento         TEXT NOT NULL,
  call_sid       TEXT,
  aplicado       BOOLEAN NOT NULL DEFAULT false,
  motivo         TEXT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_external_step_events_execution ON external_step_events (execution_id);
ALTER TABLE external_step_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_step_events_org ON external_step_events;
CREATE POLICY external_step_events_org ON external_step_events FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

-- ── execution_id determinístico ──────────────────────────────────────────────
-- uuid_v5(namespace fixo, enrollment|step|tentativa). Mesmos insumos → mesmo id,
-- em qualquer recuperação. Namespace próprio do BDR (não colide com o V4 Call,
-- que só armazena o id que recebe).
CREATE OR REPLACE FUNCTION public.bdr_step_execution_id(p_enrollment_id UUID, p_step_id UUID, p_attempt INTEGER)
RETURNS UUID LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT uuid_generate_v5(
    'a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'::uuid,
    p_enrollment_id::text || '|' || p_step_id::text || '|' || p_attempt::text
  );
$$;

-- ── claim_due_steps ──────────────────────────────────────────────────────────
-- Reserva até p_limit passos vencidos do canal pedido, nas cadências pedidas,
-- da org pedida. Pula linhas travadas por outro executor (SKIP LOCKED), leases
-- vigentes, leads com hold de prospecção/total e cadências/leads inativos.
-- Devolve tudo o que o n8n precisa para o dispatch no V4 Call.
DROP FUNCTION IF EXISTS public.claim_due_steps(UUID, UUID[], TEXT, INTEGER, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.claim_due_steps(
  p_org_id        UUID,
  p_cadence_ids   UUID[],
  p_channel       TEXT    DEFAULT 'phone',
  p_limit         INTEGER DEFAULT 10,
  p_lease_minutes INTEGER DEFAULT 15,
  p_owner         TEXT    DEFAULT NULL
)
RETURNS TABLE (
  execution_id      UUID,
  attempt           INTEGER,
  recuperada        BOOLEAN,
  lease_until       TIMESTAMPTZ,
  enrollment_id     UUID,
  org_id            UUID,
  cadence_id        UUID,
  cadence_name      TEXT,
  step_id           UUID,
  step_order        INTEGER,
  channel           TEXT,
  call_provider     TEXT,
  activity_name     TEXT,
  instructions      TEXT,
  next_step_due     TIMESTAMPTZ,
  dono              UUID,
  lead_id           UUID,
  lead_nome         TEXT,
  lead_empresa      TEXT,
  lead_cargo        TEXT,
  lead_telefone     TEXT,
  lead_email        TEXT,
  lead_segmento     TEXT,
  lead_custom       JSONB
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  r            RECORD;
  v_limit      INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease      INTERVAL := make_interval(mins => LEAST(GREATEST(COALESCE(p_lease_minutes, 15), 1), 240));
  v_exec       cadence_step_executions%ROWTYPE;
  v_exec_id    UUID;
  v_attempt    INTEGER;
  v_recuperada BOOLEAN;
BEGIN
  IF p_org_id IS NULL OR p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL THEN
    RETURN;
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
           l.custom_field_values AS lead_custom
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
     ORDER BY ce.next_step_due ASC, ce.id ASC
     LIMIT v_limit
       FOR UPDATE OF ce SKIP LOCKED
  LOOP
    v_exec := NULL;
    v_recuperada := false;

    -- Recuperação técnica: execução aberta (não confirmada, não liberada para
    -- nova tentativa) do MESMO passo → reutiliza o id.
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
      -- Nova tentativa comercial: só chega aqui sem execução aberta (primeira
      -- vez no passo, ou liberação explícita com p_nova_tentativa).
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
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_steps(UUID, UUID[], TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_steps(UUID, UUID[], TEXT, INTEGER, INTEGER, TEXT) TO service_role;
COMMENT ON FUNCTION public.claim_due_steps(UUID, UUID[], TEXT, INTEGER, INTEGER, TEXT) IS
  'BDR-2: reserva passos vencidos (SKIP LOCKED + lease) e devolve execution_id persistente por (inscrição, passo, tentativa). Recuperação reutiliza o id.';

-- ── renew_step_lease (heartbeat) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renew_step_lease(
  p_org_id        UUID,
  p_execution_id  UUID,
  p_owner         TEXT    DEFAULT NULL,
  p_lease_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows  INTEGER;
  v_lease INTERVAL := make_interval(mins => LEAST(GREATEST(COALESCE(p_lease_minutes, 15), 1), 240));
BEGIN
  UPDATE cadence_step_executions x
     SET lease_until = now() + v_lease
   WHERE x.execution_id = p_execution_id
     AND x.org_id = p_org_id
     AND x.confirmed_at IS NULL
     AND x.released_at IS NULL
     AND (p_owner IS NULL OR x.lease_owner IS NULL OR x.lease_owner = p_owner);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;

  UPDATE cadence_enrollments ce
     SET lease_until = now() + v_lease
   WHERE ce.execution_id = p_execution_id AND ce.org_id = p_org_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.renew_step_lease(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_step_lease(UUID, UUID, TEXT, INTEGER) TO service_role;

-- ── release_step_claim ───────────────────────────────────────────────────────
-- Devolve o passo à fila antes de o lease expirar (ex.: V4 Call respondeu 429
-- capacidade / 503 pool_esgotado). Por padrão mantém a execução aberta — a
-- próxima reserva reutiliza o MESMO execution_id (o V4 Call devolve o call_sid
-- se a ligação já tiver sido aceita). p_nova_tentativa=true é a DECISÃO
-- EXPLÍCITA de nova tentativa comercial: fecha a execução e a próxima reserva
-- gera attempt+1 (novo id). Registra o motivo.
CREATE OR REPLACE FUNCTION public.release_step_claim(
  p_org_id         UUID,
  p_execution_id   UUID,
  p_motivo         TEXT    DEFAULT NULL,
  p_nova_tentativa BOOLEAN DEFAULT false,
  p_owner          TEXT    DEFAULT NULL
)
RETURNS TABLE (liberada BOOLEAN, motivo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exec cadence_step_executions%ROWTYPE;
BEGIN
  SELECT * INTO v_exec FROM cadence_step_executions x
   WHERE x.execution_id = p_execution_id AND x.org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'execution_id_desconhecida'::text; RETURN;
  END IF;
  IF v_exec.confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'execucao_ja_confirmada'::text; RETURN;
  END IF;
  IF p_owner IS NOT NULL AND v_exec.lease_owner IS NOT NULL AND v_exec.lease_owner <> p_owner
     AND v_exec.lease_until IS NOT NULL AND v_exec.lease_until >= now() THEN
    RETURN QUERY SELECT false, 'lease_de_outro_executor'::text; RETURN;
  END IF;

  IF p_nova_tentativa THEN
    UPDATE cadence_step_executions
       SET released_at = now(), release_motivo = p_motivo, lease_until = NULL, lease_owner = NULL
     WHERE cadence_step_executions.execution_id = p_execution_id;
    UPDATE cadence_enrollments
       SET execution_id = NULL, lease_until = NULL, lease_owner = NULL
     WHERE cadence_enrollments.execution_id = p_execution_id;
    RETURN QUERY SELECT true, 'nova_tentativa_autorizada'::text; RETURN;
  END IF;

  UPDATE cadence_step_executions
     SET lease_until = NULL, lease_owner = NULL, release_motivo = p_motivo
   WHERE cadence_step_executions.execution_id = p_execution_id;
  UPDATE cadence_enrollments
     SET lease_until = NULL, lease_owner = NULL
   WHERE cadence_enrollments.execution_id = p_execution_id;
  RETURN QUERY SELECT true, 'devolvida_mesma_execucao'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.release_step_claim(UUID, UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_step_claim(UUID, UUID, TEXT, BOOLEAN, TEXT) TO service_role;

-- ── confirm_external_step ────────────────────────────────────────────────────
-- Consumidor do evento terminal do V4 Call (chamada_finalizada | caixa_postal |
-- chamada_falhou), numa única transação:
--   1. registra o event_id (ON CONFLICT → duplicado, nada mais acontece);
--   2. localiza a execução pelo execution_id e confere passo atual da inscrição;
--   3. grava a interaction do passo (sent | failed) e marca a execução confirmada;
--   4. avança a inscrição via advance_enrollment_after_step (idempotente).
-- Evento fora de ordem/duplicado → 1 interaction, 1 avanço (plano §8).
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

  -- Fecha a execução em qualquer caso (o evento terminal chegou; ninguém redisca).
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
      WHEN 'chamada_falhou'     THEN 'Ligação falhou (' || COALESCE(p_payload ->> 'motivo', 'falha_na_ligacao') || ').'
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
  'BDR-2: aplica evento terminal do V4 Call ao passo reservado — idempotente por event_id e execution_id; 1 interaction, 1 avanço.';

COMMIT;

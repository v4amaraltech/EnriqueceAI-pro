-- PR07 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 4.2):
-- outbox transacional de envio e trilha append-only de eventos.
--
-- Aditiva e forward-only: nao altera tabelas existentes, nao faz backfill e NAO
-- despacha mensagem. Nao ha consumidor, worker ou cron: as RPCs so reservam e
-- registram estado. A escrita so acontece pelo servico
-- (features/contact-engine/services/outbox.service.ts) com a flag
-- `send_outbox_enqueue` ligada (nasce desligada em app_flags).
--
-- Modelo:
--   send_outbox   uma linha por acao comercial. `idempotency_key` e unica por
--                 organizacao e independente de provedor: dois provedores nunca
--                 executam a mesma acao. `version` e o controle otimista (CAS).
--   send_events   trilha append-only de cada transicao.
--
-- Estados: pending, reserved, sending, sent, failed, uncertain, suppressed, cancelled.
-- `uncertain` significa que a mensagem pode ter saido: aguarda reconciliacao, sem
-- retry cego e sem fallback para outro provedor, numero ou canal.
--
-- Escrita: somente service_role (servico e RPCs). `authenticated` apenas le, e so
-- dentro da propria organizacao (RLS com public.user_org_id()).

BEGIN;

-- 1. send_outbox ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.send_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id           uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel           text NOT NULL,
  -- Identidade normalizada do destinatario (digitos ou e-mail em minusculas),
  -- usada para revalidar opt-out. Nunca carrega corpo de mensagem.
  contact_identity  text NOT NULL,
  idempotency_key   text NOT NULL,
  -- Comando autorizado pelo gateway (provedor, instancia, template, versao de
  -- ownership, hash do payload, prazo). Sem segredos, tokens ou corpo de mensagem.
  command           jsonb NOT NULL,
  provider          text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  lease_owner       text,
  lease_expires_at  timestamptz,
  attempts          integer NOT NULL DEFAULT 0,
  version           integer NOT NULL DEFAULT 1,
  external_id       text,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT send_outbox_channel_chk
    CHECK (channel IN ('email', 'whatsapp', 'phone', 'linkedin', 'research')),
  CONSTRAINT send_outbox_provider_chk
    CHECK (provider IN ('meta_cloud', 'evolution', 'gmail')),
  CONSTRAINT send_outbox_status_chk
    CHECK (status IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'uncertain', 'suppressed', 'cancelled')),
  CONSTRAINT send_outbox_key_chk
    CHECK (idempotency_key <> '' AND idempotency_key = btrim(idempotency_key)),
  CONSTRAINT send_outbox_identity_chk
    CHECK (contact_identity <> '' AND contact_identity = btrim(contact_identity)),
  CONSTRAINT send_outbox_command_chk CHECK (jsonb_typeof(command) = 'object'),
  CONSTRAINT send_outbox_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT send_outbox_version_chk CHECK (version >= 1),
  CONSTRAINT send_outbox_sent_external_chk
    CHECK (status <> 'sent' OR (external_id IS NOT NULL AND external_id <> ''))
);

-- Chave comercial unica por organizacao, sem provedor na chave.
CREATE UNIQUE INDEX IF NOT EXISTS ux_send_outbox_org_key
  ON public.send_outbox (org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_send_outbox_claimable
  ON public.send_outbox (org_id, created_at)
  WHERE status IN ('pending', 'reserved', 'sending');
CREATE INDEX IF NOT EXISTS idx_send_outbox_lead
  ON public.send_outbox (org_id, lead_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.send_outbox;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.send_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.send_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS send_outbox_org_select ON public.send_outbox;
CREATE POLICY send_outbox_org_select ON public.send_outbox
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 2. send_events (append-only) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.send_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outbox_id  uuid NOT NULL REFERENCES public.send_outbox(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  -- Ids e motivos apenas. Sem segredos, tokens ou corpo de mensagem.
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT send_events_kind_chk CHECK (kind IN (
    'enqueued', 'reserved', 'revalidated', 'lease_expired', 'sending',
    'sent', 'failed', 'uncertain', 'suppressed', 'cancelled'
  ))
);

CREATE INDEX IF NOT EXISTS idx_send_events_outbox
  ON public.send_events (outbox_id, created_at);
CREATE INDEX IF NOT EXISTS idx_send_events_org
  ON public.send_events (org_id, created_at);

ALTER TABLE public.send_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS send_events_org_select ON public.send_events;
CREATE POLICY send_events_org_select ON public.send_events
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- Append-only: reaproveita a funcao do PR05 (UPDATE e DELETE diretos sao
-- rejeitados; o DELETE em cascata da remocao de organizacao/lead continua valido).
DROP TRIGGER IF EXISTS send_events_append_only ON public.send_events;
CREATE TRIGGER send_events_append_only
  BEFORE UPDATE OR DELETE ON public.send_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

-- 3. Grants minimos ------------------------------------------------------------------
REVOKE ALL ON public.send_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.send_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.send_outbox TO authenticated;
GRANT SELECT ON public.send_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.send_outbox TO service_role;
GRANT SELECT, INSERT ON public.send_events TO service_role;

-- 4. Helper: supressao vigente ----------------------------------------------------------
-- Verdadeiro se o lead tem qualquer hold (o gateway tambem nega com qualquer
-- hold) ou se o ultimo consentimento da identidade no canal e opt_out.
CREATE OR REPLACE FUNCTION public.send_outbox_suppression_reason(
  p_org_id           uuid,
  p_lead_id          uuid,
  p_channel          text,
  p_contact_identity text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_hold text;
  v_consent text;
BEGIN
  SELECT h.tipo INTO v_hold
  FROM public.contact_holds h
  WHERE h.org_id = p_org_id AND h.lead_id = p_lead_id
  ORDER BY (h.tipo = 'total') DESC
  LIMIT 1;
  IF v_hold IS NOT NULL THEN
    RETURN 'hold_' || v_hold;
  END IF;

  SELECT c.kind INTO v_consent
  FROM public.contact_consent_evidence c
  WHERE c.org_id = p_org_id AND c.contact_identity = p_contact_identity AND c.channel = p_channel
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1;
  IF v_consent = 'opt_out' THEN
    RETURN 'consent_opted_out';
  END IF;

  RETURN NULL;
END;
$$;

-- 5. RPC enqueue_send ---------------------------------------------------------------------
-- Idempotente pela chave comercial: a segunda chamada devolve a linha existente
-- (outcome 'duplicate') sem alterar nada. Defesa em profundidade: a RPC tambem
-- confere a flag `send_outbox_enqueue`.
-- outcome: 'enqueued' | 'duplicate' | 'flag_disabled' | 'lead_not_in_org' | 'invalid_input'
CREATE OR REPLACE FUNCTION public.enqueue_send(
  p_org_id           uuid,
  p_lead_id          uuid,
  p_channel          text,
  p_contact_identity text,
  p_idempotency_key  text,
  p_provider         text,
  p_command          jsonb
)
RETURNS TABLE (outcome text, outbox_id uuid, status text, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_version integer;
BEGIN
  IF NOT COALESCE((SELECT f.enabled FROM public.app_flags f WHERE f.key = 'send_outbox_enqueue'), false) THEN
    RETURN QUERY SELECT 'flag_disabled'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object'
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_contact_identity IS NULL OR btrim(p_contact_identity) = '' THEN
    RETURN QUERY SELECT 'invalid_input'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.org_id = p_org_id) THEN
    RETURN QUERY SELECT 'lead_not_in_org'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO public.send_outbox AS o
    (org_id, lead_id, channel, contact_identity, idempotency_key, command, provider)
  VALUES
    (p_org_id, p_lead_id, p_channel, p_contact_identity, p_idempotency_key, p_command, p_provider)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING o.id, o.status, o.version INTO v_id, v_status, v_version;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_id, 'enqueued', jsonb_build_object('provider', p_provider, 'channel', p_channel));
    RETURN QUERY SELECT 'enqueued'::text, v_id, v_status, v_version;
    RETURN;
  END IF;

  SELECT o.id, o.status, o.version INTO v_id, v_status, v_version
  FROM public.send_outbox o
  WHERE o.org_id = p_org_id AND o.idempotency_key = p_idempotency_key;
  RETURN QUERY SELECT 'duplicate'::text, v_id, v_status, v_version;
END;
$$;

-- 6. RPC claim_send --------------------------------------------------------------------------
-- Reserva atomica de UMA entrada com lease. FOR UPDATE SKIP LOCKED: dois claims
-- concorrentes nunca recebem a mesma linha. Candidatas: 'pending' e 'reserved'
-- com lease vencido (ainda nao houve tentativa de envio, reservar de novo e seguro).
-- 'sending' com lease vencido NAO volta para a fila: a mensagem pode ter saido,
-- entao vira 'uncertain' (sem retry cego).
-- Antes de reservar, revalida supressao (hold ou opt-out). Se suprimida, marca
-- 'suppressed' e tenta a proxima candidata.
-- outcome: 'claimed' | 'empty'
CREATE OR REPLACE FUNCTION public.claim_send(
  p_org_id        uuid,
  p_lease_owner   text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
  outcome text, outbox_id uuid, command jsonb, provider text, channel text,
  lead_id uuid, version integer, attempts integer, lease_expires_at timestamptz,
  suppressed_count integer, uncertain_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_row public.send_outbox%ROWTYPE;
  v_reason text;
  v_suppressed integer := 0;
  v_uncertain integer := 0;
  v_expired record;
BEGIN
  IF p_lease_owner IS NULL OR btrim(p_lease_owner) = '' OR p_lease_seconds IS NULL
     OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'claim_send: parametros invalidos' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. Lease vencido em 'sending': incerto, nunca reenvia.
  FOR v_expired IN
    SELECT o.id FROM public.send_outbox o
    WHERE o.org_id = p_org_id AND o.status = 'sending' AND o.lease_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.send_outbox o
    SET status = 'uncertain', version = o.version + 1,
        last_error = 'lease_expired_while_sending'
    WHERE o.id = v_expired.id;
    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_expired.id, 'lease_expired', jsonb_build_object('from', 'sending'));
    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_expired.id, 'uncertain', jsonb_build_object('reason', 'lease_expired_while_sending'));
    v_uncertain := v_uncertain + 1;
  END LOOP;

  -- 2. Reserva a proxima candidata nao suprimida.
  LOOP
    SELECT * INTO v_row
    FROM public.send_outbox o
    WHERE o.org_id = p_org_id
      AND (o.status = 'pending' OR (o.status = 'reserved' AND o.lease_expires_at < now()))
    ORDER BY o.created_at, o.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_row.id IS NULL THEN
      RETURN QUERY SELECT 'empty'::text, NULL::uuid, NULL::jsonb, NULL::text, NULL::text,
        NULL::uuid, NULL::integer, NULL::integer, NULL::timestamptz, v_suppressed, v_uncertain;
      RETURN;
    END IF;

    IF v_row.status = 'reserved' THEN
      INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
      VALUES (p_org_id, v_row.id, 'lease_expired', jsonb_build_object('from', 'reserved'));
    END IF;

    v_reason := public.send_outbox_suppression_reason(
      p_org_id, v_row.lead_id, v_row.channel, v_row.contact_identity);

    IF v_reason IS NOT NULL THEN
      UPDATE public.send_outbox o
      SET status = 'suppressed', lease_owner = NULL, lease_expires_at = NULL,
          version = o.version + 1, last_error = v_reason
      WHERE o.id = v_row.id;
      INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
      VALUES (p_org_id, v_row.id, 'suppressed', jsonb_build_object('reason', v_reason, 'stage', 'claim'));
      v_suppressed := v_suppressed + 1;
      v_row.id := NULL;
      CONTINUE;
    END IF;

    UPDATE public.send_outbox o
    SET status = 'reserved', lease_owner = p_lease_owner,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempts = o.attempts + 1, version = o.version + 1
    WHERE o.id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_row.id, 'revalidated', jsonb_build_object('stage', 'claim'));
    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_row.id, 'reserved',
            jsonb_build_object('attempt', v_row.attempts, 'lease_owner', p_lease_owner));

    RETURN QUERY SELECT 'claimed'::text, v_row.id, v_row.command, v_row.provider, v_row.channel,
      v_row.lead_id, v_row.version, v_row.attempts, v_row.lease_expires_at, v_suppressed, v_uncertain;
    RETURN;
  END LOOP;
END;
$$;

-- 7. RPC confirm_send ---------------------------------------------------------------------------
-- Transicao com CAS por version, restrita ao dono do lease.
--   reserved -> sending | cancelled | failed
--   sending  -> sent (exige external_id) | failed | uncertain (timeout)
-- A passagem para 'sending' revalida supressao de novo (imediatamente antes do
-- envio) e, se suprimida, marca 'suppressed' em vez de liberar o envio.
-- outcome: 'confirmed' | 'suppressed' | 'version_conflict' | 'not_found' |
--          'lease_mismatch' | 'invalid_transition' | 'invalid_input'
CREATE OR REPLACE FUNCTION public.confirm_send(
  p_org_id           uuid,
  p_outbox_id        uuid,
  p_expected_version integer,
  p_lease_owner      text,
  p_target           text,
  p_external_id      text DEFAULT NULL,
  p_error            text DEFAULT NULL
)
RETURNS TABLE (outcome text, outbox_id uuid, status text, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_row public.send_outbox%ROWTYPE;
  v_reason text;
  v_ext text := NULLIF(btrim(COALESCE(p_external_id, '')), '');
  v_err text := NULLIF(left(btrim(COALESCE(p_error, '')), 300), '');
BEGIN
  IF p_target IS NULL OR p_target NOT IN ('sending', 'sent', 'failed', 'uncertain', 'cancelled')
     OR (p_target = 'sent' AND v_ext IS NULL) THEN
    RETURN QUERY SELECT 'invalid_input'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.send_outbox o
  WHERE o.id = p_outbox_id AND o.org_id = p_org_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_row.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;
  IF v_row.lease_owner IS DISTINCT FROM p_lease_owner THEN
    RETURN QUERY SELECT 'lease_mismatch'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;
  IF NOT (
    (v_row.status = 'reserved' AND p_target IN ('sending', 'cancelled', 'failed'))
    OR (v_row.status = 'sending' AND p_target IN ('sent', 'failed', 'uncertain'))
  ) THEN
    RETURN QUERY SELECT 'invalid_transition'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;

  IF p_target = 'sending' THEN
    v_reason := public.send_outbox_suppression_reason(
      p_org_id, v_row.lead_id, v_row.channel, v_row.contact_identity);
    IF v_reason IS NOT NULL THEN
      UPDATE public.send_outbox o
      SET status = 'suppressed', lease_owner = NULL, lease_expires_at = NULL,
          version = o.version + 1, last_error = v_reason
      WHERE o.id = v_row.id
      RETURNING * INTO v_row;
      INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
      VALUES (p_org_id, v_row.id, 'suppressed', jsonb_build_object('reason', v_reason, 'stage', 'pre_send'));
      RETURN QUERY SELECT 'suppressed'::text, v_row.id, v_row.status, v_row.version;
      RETURN;
    END IF;
    INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
    VALUES (p_org_id, v_row.id, 'revalidated', jsonb_build_object('stage', 'pre_send'));
  END IF;

  UPDATE public.send_outbox o
  SET status = p_target,
      version = o.version + 1,
      external_id = CASE WHEN p_target = 'sent' THEN v_ext ELSE o.external_id END,
      last_error = CASE WHEN p_target IN ('failed', 'uncertain') THEN v_err ELSE o.last_error END,
      lease_owner = CASE WHEN p_target = 'sending' THEN o.lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_target = 'sending' THEN o.lease_expires_at ELSE NULL END
  WHERE o.id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
  VALUES (p_org_id, v_row.id, p_target,
          CASE WHEN p_target = 'sent' THEN jsonb_build_object('has_external_id', true)
               WHEN v_err IS NOT NULL THEN jsonb_build_object('error', v_err)
               ELSE '{}'::jsonb END);

  RETURN QUERY SELECT 'confirmed'::text, v_row.id, v_row.status, v_row.version;
END;
$$;

-- RPCs: somente service_role (o servico valida a organizacao do ator).
REVOKE EXECUTE ON FUNCTION public.send_outbox_suppression_reason(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_send(uuid, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_send(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_send(uuid, uuid, integer, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_outbox_suppression_reason(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_send(uuid, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_send(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_send(uuid, uuid, integer, text, text, text, text) TO service_role;

-- 8. Flag (nasce DESLIGADA; escopo global como as demais flags de app_flags) ------
INSERT INTO public.app_flags (key, enabled, note)
VALUES ('send_outbox_enqueue', false, 'PR07: enfileirar na outbox de envio (sem consumidor, nada e despachado)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

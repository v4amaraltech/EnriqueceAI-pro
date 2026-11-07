-- PR08 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 4.2):
-- dispatcher e reconciliacao da outbox de envio.
--
-- Aditiva e forward-only: alarga CHECKs da outbox (novo status `delivered`, novos
-- tipos de evento), adiciona um indice de busca por external_id, a RPC
-- `reconcile_send` e a flag `dispatcher_v1` (nasce DESLIGADA). Nao altera
-- `enqueue_send`, `claim_send` nem `confirm_send`, nao faz backfill e NAO agenda
-- cron: ativar o dispatcher e uma acao separada (ver secao 10 do documento).
--
-- `reconcile_send` resolve o que o dispatcher nao conseguiu fechar:
--   uncertain                         -> sent | delivered | failed | pending (retry) | cancelled
--   sending com lease vencido         -> idem (equivale a uncertain)
--   sent                              -> delivered | failed (callbacks do provedor)
-- Repeticoes e callbacks fora de ordem sao idempotentes: o estado nunca regride
-- (`delivered` nao volta para `sent`) e a repeticao devolve `noop`.
-- `pending` (retry) so e pedido pelo servico quando o provedor CONFIRMA que nao
-- houve aceitacao; a RPC nao decide isso, apenas executa a transicao com CAS.

BEGIN;

-- 1. send_outbox: status `delivered` ---------------------------------------------------
ALTER TABLE public.send_outbox DROP CONSTRAINT IF EXISTS send_outbox_status_chk;
ALTER TABLE public.send_outbox ADD CONSTRAINT send_outbox_status_chk
  CHECK (status IN ('pending', 'reserved', 'sending', 'sent', 'delivered', 'failed', 'uncertain', 'suppressed', 'cancelled'));

ALTER TABLE public.send_outbox DROP CONSTRAINT IF EXISTS send_outbox_sent_external_chk;
ALTER TABLE public.send_outbox ADD CONSTRAINT send_outbox_sent_external_chk
  CHECK (status NOT IN ('sent', 'delivered') OR (external_id IS NOT NULL AND external_id <> ''));

CREATE INDEX IF NOT EXISTS idx_send_outbox_external
  ON public.send_outbox (org_id, external_id)
  WHERE external_id IS NOT NULL;

-- Candidatas a reconciliacao.
CREATE INDEX IF NOT EXISTS idx_send_outbox_reconcilable
  ON public.send_outbox (org_id, updated_at)
  WHERE status IN ('uncertain', 'sending');

-- 2. send_events: novos tipos ---------------------------------------------------------------
ALTER TABLE public.send_events DROP CONSTRAINT IF EXISTS send_events_kind_chk;
ALTER TABLE public.send_events ADD CONSTRAINT send_events_kind_chk CHECK (kind IN (
  'enqueued', 'reserved', 'revalidated', 'lease_expired', 'sending',
  'sent', 'failed', 'uncertain', 'suppressed', 'cancelled',
  'delivered', 'reconciled', 'retry_scheduled'
));

-- 3. RPC reconcile_send ------------------------------------------------------------------------
-- CAS por version. Nao exige lease: o lock da linha (FOR UPDATE) serializa com o
-- dispatcher, e a mudanca de version faz um confirm_send tardio falhar com
-- version_conflict em vez de sobrescrever.
-- outcome: 'confirmed' | 'noop' | 'version_conflict' | 'not_found' |
--          'invalid_transition' | 'external_id_mismatch' | 'invalid_input'
CREATE OR REPLACE FUNCTION public.reconcile_send(
  p_org_id           uuid,
  p_outbox_id        uuid,
  p_expected_version integer,
  p_target           text,
  p_source           text,
  p_external_id      text DEFAULT NULL,
  p_error            text DEFAULT NULL,
  p_command_patch    jsonb DEFAULT NULL
)
RETURNS TABLE (outcome text, outbox_id uuid, status text, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_row public.send_outbox%ROWTYPE;
  v_open boolean;
  v_allowed boolean := false;
  v_ext text := NULLIF(btrim(COALESCE(p_external_id, '')), '');
  v_err text := NULLIF(left(btrim(COALESCE(p_error, '')), 300), '');
  v_src text := NULLIF(left(btrim(COALESCE(p_source, '')), 60), '');
  v_final_ext text;
BEGIN
  IF p_target IS NULL OR p_target NOT IN ('sent', 'delivered', 'failed', 'pending', 'cancelled')
     OR v_src IS NULL OR p_expected_version IS NULL
     OR (p_command_patch IS NOT NULL AND jsonb_typeof(p_command_patch) <> 'object')
     OR (p_command_patch IS NOT NULL AND p_target <> 'pending') THEN
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

  -- external_id ja gravado nunca e trocado por outro.
  IF v_ext IS NOT NULL AND v_row.external_id IS NOT NULL AND v_row.external_id <> v_ext THEN
    RETURN QUERY SELECT 'external_id_mismatch'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;

  v_open := v_row.status = 'uncertain'
            OR (v_row.status = 'sending' AND v_row.lease_expires_at < now());

  IF v_open THEN
    v_allowed := true;
  ELSIF v_row.status = 'sent' THEN
    IF p_target = 'sent' THEN
      RETURN QUERY SELECT 'noop'::text, v_row.id, v_row.status, v_row.version;
      RETURN;
    END IF;
    v_allowed := p_target IN ('delivered', 'failed');
  ELSIF v_row.status = 'delivered' THEN
    -- Callback antigo ('sent') ou falha tardia nunca rebaixa uma entrega.
    IF p_target IN ('sent', 'delivered', 'failed') THEN
      RETURN QUERY SELECT 'noop'::text, v_row.id, v_row.status, v_row.version;
      RETURN;
    END IF;
  ELSIF v_row.status = 'failed' AND p_target = 'failed' THEN
    RETURN QUERY SELECT 'noop'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  ELSIF v_row.status = 'cancelled' AND p_target = 'cancelled' THEN
    RETURN QUERY SELECT 'noop'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT 'invalid_transition'::text, v_row.id, v_row.status, v_row.version;
    RETURN;
  END IF;

  v_final_ext := COALESCE(v_ext, v_row.external_id);
  IF p_target IN ('sent', 'delivered') AND v_final_ext IS NULL THEN
    RETURN QUERY SELECT 'invalid_input'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.send_outbox o
  SET status = p_target,
      version = o.version + 1,
      external_id = CASE WHEN p_target IN ('sent', 'delivered') THEN v_final_ext ELSE o.external_id END,
      last_error = CASE WHEN p_target IN ('failed', 'cancelled') THEN v_err ELSE o.last_error END,
      command = CASE WHEN p_command_patch IS NOT NULL THEN o.command || p_command_patch ELSE o.command END,
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE o.id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
  VALUES (p_org_id, v_row.id, 'reconciled',
          jsonb_build_object('source', v_src, 'to', p_target));
  INSERT INTO public.send_events (org_id, outbox_id, kind, detail)
  VALUES (p_org_id, v_row.id,
          CASE p_target WHEN 'pending' THEN 'retry_scheduled' ELSE p_target END,
          CASE WHEN p_target IN ('sent', 'delivered') THEN jsonb_build_object('has_external_id', true)
               WHEN v_err IS NOT NULL THEN jsonb_build_object('error', v_err)
               ELSE '{}'::jsonb END);

  RETURN QUERY SELECT 'confirmed'::text, v_row.id, v_row.status, v_row.version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_send(uuid, uuid, integer, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_send(uuid, uuid, integer, text, text, text, text, jsonb)
  TO service_role;

-- 4. Flag (nasce DESLIGADA; escopo global como as demais flags de app_flags) ------------
INSERT INTO public.app_flags (key, enabled, note)
VALUES ('dispatcher_v1', false, 'PR08: dispatcher e reconciliacao da outbox de envio (desligada: a rota de cron nao faz nada)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

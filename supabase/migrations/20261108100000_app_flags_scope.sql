BEGIN;

-- =============================================================================
-- PR12: escopo opcional por organizacao e por usuario em app_flags.
-- Aditiva: so adiciona duas colunas com default vazio. Nenhuma flag e ligada aqui.
-- Flag global desligada + listas vazias = comportamento identico ao atual.
-- Semantica (ver src/features/contact-engine/services/flag-scope.service.ts):
--   enabled = true            -> ligada para todos
--   org em allow_org_ids      -> ligada para a organizacao
--   allow_user_ids preenchida -> estreita os caminhos que carregam usuario
-- Escrita continua so via service_role; a policy de leitura para managers ja existe.
-- =============================================================================

ALTER TABLE public.app_flags
  ADD COLUMN IF NOT EXISTS allow_org_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allow_user_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.app_flags.allow_org_ids IS
  'Organizacoes para as quais a flag vale mesmo com enabled = false. Vazio = so o escopo global.';
COMMENT ON COLUMN public.app_flags.allow_user_ids IS
  'Estreita o piloto: nos caminhos com usuario, so estes usuarios (dentro das organizacoes liberadas).';

-- enqueue_send: o portao interno passa a respeitar o corte por organizacao.
-- Unica mudanca em relacao a 20261107170000: o IF da flag. Com allow_org_ids vazio
-- (default) o resultado e identico ao de antes. Grants existentes sao preservados.
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
  IF NOT COALESCE((
    SELECT f.enabled OR p_org_id = ANY (f.allow_org_ids)
    FROM public.app_flags f WHERE f.key = 'send_outbox_enqueue'
  ), false) THEN
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

COMMIT;

NOTIFY pgrst, 'reload schema';

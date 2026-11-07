-- PR05 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 3):
-- ownership canonico de conversa e evidencia de consentimento.
--
-- Aditiva e forward-only: nao altera tabelas existentes, nao faz backfill e nao
-- transfere carteiras. A escrita so acontece pelo servico
-- (features/contact-engine/services/ownership.service.ts) com a flag
-- `conversation_ownership_v1` ligada (nasce desligada em app_flags).
--
-- Modelo:
--   conversation_ownership         um dono ativo por (org, identidade, canal);
--                                  `version` e o controle otimista (CAS).
--   conversation_ownership_events  trilha append-only de claim, transfer e release.
--   contact_consent_evidence       evidencia append-only de opt_in e opt_out.
--
-- A identidade do contato e normalizada pelo servico: telefone somente em digitos
-- (E.164 sem "+") e e-mail em minusculas. Um lead com varios contatos tem uma
-- linha de ownership por identidade.
--
-- Escrita: somente service_role (servico e RPCs). `authenticated` apenas le, e so
-- dentro da propria organizacao (RLS com public.user_org_id()).

BEGIN;

-- 1. conversation_ownership ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_ownership (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id            uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES public.lead_contacts(id) ON DELETE SET NULL,
  contact_identity   text NOT NULL,
  channel            text NOT NULL,
  owner_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  automation_mode    text NOT NULL DEFAULT 'human',
  provider           text,
  sender_instance_id uuid,
  status             text NOT NULL DEFAULT 'active',
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_ownership_identity_chk
    CHECK (contact_identity <> '' AND contact_identity = btrim(contact_identity)),
  CONSTRAINT conversation_ownership_channel_chk
    CHECK (channel IN ('email', 'whatsapp', 'phone', 'linkedin', 'research')),
  CONSTRAINT conversation_ownership_mode_chk
    CHECK (automation_mode IN ('automatic', 'human', 'paused')),
  CONSTRAINT conversation_ownership_provider_chk
    CHECK (provider IS NULL OR provider IN ('meta_cloud', 'evolution', 'gmail')),
  CONSTRAINT conversation_ownership_status_chk
    CHECK (status IN ('active', 'released')),
  CONSTRAINT conversation_ownership_version_chk CHECK (version >= 1)
);

-- Um registro ativo por (org, identidade, canal). Liberados ficam como historico.
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversation_ownership_active
  ON public.conversation_ownership (org_id, contact_identity, channel)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_conversation_ownership_lead
  ON public.conversation_ownership (org_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_conversation_ownership_owner
  ON public.conversation_ownership (org_id, owner_user_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS set_updated_at ON public.conversation_ownership;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_ownership
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.conversation_ownership ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_ownership_org_select ON public.conversation_ownership;
CREATE POLICY conversation_ownership_org_select ON public.conversation_ownership
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 2. conversation_ownership_events (append-only) ------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_ownership_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ownership_id     uuid NOT NULL REFERENCES public.conversation_ownership(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_identity text NOT NULL,
  channel          text NOT NULL,
  kind             text NOT NULL,
  from_user_id     uuid,
  to_user_id       uuid,
  from_version     integer,
  to_version       integer NOT NULL,
  reason           text,
  actor_user_id    uuid,
  actor_source     text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_ownership_events_kind_chk
    CHECK (kind IN ('claim', 'transfer', 'release')),
  CONSTRAINT conversation_ownership_events_source_chk
    CHECK (actor_source IN ('app', 'cron', 'n8n', 'webhook', 'api_key'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_ownership_events_ownership
  ON public.conversation_ownership_events (ownership_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_ownership_events_org_lead
  ON public.conversation_ownership_events (org_id, lead_id);

ALTER TABLE public.conversation_ownership_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_ownership_events_org_select ON public.conversation_ownership_events;
CREATE POLICY conversation_ownership_events_org_select ON public.conversation_ownership_events
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 3. contact_consent_evidence (append-only) -----------------------------------
CREATE TABLE IF NOT EXISTS public.contact_consent_evidence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_identity text NOT NULL,
  channel          text NOT NULL,
  kind             text NOT NULL,
  source           text NOT NULL,
  -- Referencia e resumo da evidencia (ids, ex.: interaction_id, call_id). Sem
  -- segredos, tokens ou corpo de mensagem.
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_consent_evidence_identity_chk
    CHECK (contact_identity <> '' AND contact_identity = btrim(contact_identity)),
  CONSTRAINT contact_consent_evidence_channel_chk
    CHECK (channel IN ('email', 'whatsapp', 'phone', 'linkedin', 'research')),
  CONSTRAINT contact_consent_evidence_kind_chk CHECK (kind IN ('opt_in', 'opt_out')),
  CONSTRAINT contact_consent_evidence_source_chk CHECK (source <> '')
);

CREATE INDEX IF NOT EXISTS idx_contact_consent_evidence_lookup
  ON public.contact_consent_evidence (org_id, contact_identity, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_consent_evidence_lead
  ON public.contact_consent_evidence (org_id, lead_id);

ALTER TABLE public.contact_consent_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_consent_evidence_org_select ON public.contact_consent_evidence;
CREATE POLICY contact_consent_evidence_org_select ON public.contact_consent_evidence
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 4. Append-only: bloqueia UPDATE e DELETE nas tabelas de eventos/evidencia ---
-- UPDATE e DELETE direto sao rejeitados. O DELETE em cascata (remocao de
-- organizacao, lead ou ownership) roda dentro de trigger de integridade
-- referencial (pg_trigger_depth() > 1) e continua permitido.
CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% e append-only (% bloqueado)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS conversation_ownership_events_append_only ON public.conversation_ownership_events;
CREATE TRIGGER conversation_ownership_events_append_only
  BEFORE UPDATE OR DELETE ON public.conversation_ownership_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

DROP TRIGGER IF EXISTS contact_consent_evidence_append_only ON public.contact_consent_evidence;
CREATE TRIGGER contact_consent_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.contact_consent_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

-- 5. Grants minimos ------------------------------------------------------------
REVOKE ALL ON public.conversation_ownership FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conversation_ownership_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.contact_consent_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_ownership TO authenticated;
GRANT SELECT ON public.conversation_ownership_events TO authenticated;
GRANT SELECT ON public.contact_consent_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_ownership TO service_role;
GRANT SELECT, INSERT ON public.conversation_ownership_events TO service_role;
GRANT SELECT, INSERT ON public.contact_consent_evidence TO service_role;

-- 6. RPC claim_conversation_ownership ------------------------------------------
-- Atomico: o indice unico parcial decide o vencedor de claims simultaneos. Quem
-- perde recebe outcome 'conflict' com o dono atual (nunca sobrescreve).
-- outcome: 'claimed' | 'already_owner' | 'conflict' | 'lead_not_in_org'
CREATE OR REPLACE FUNCTION public.claim_conversation_ownership(
  p_org_id           uuid,
  p_lead_id          uuid,
  p_contact_identity text,
  p_channel          text,
  p_user_id          uuid,
  p_contact_id       uuid DEFAULT NULL,
  p_provider         text DEFAULT NULL,
  p_automation_mode  text DEFAULT 'human',
  p_actor_user_id    uuid DEFAULT NULL,
  p_actor_source     text DEFAULT 'app',
  p_reason           text DEFAULT NULL
)
RETURNS TABLE (outcome text, ownership_id uuid, owner_user_id uuid, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_id uuid;
  v_owner uuid;
  v_version integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.org_id = p_org_id) THEN
    RETURN QUERY SELECT 'lead_not_in_org'::text, NULL::uuid, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO public.conversation_ownership AS co
    (org_id, lead_id, contact_id, contact_identity, channel, owner_user_id,
     automation_mode, provider, status, version)
  VALUES
    (p_org_id, p_lead_id, p_contact_id, p_contact_identity, p_channel, p_user_id,
     p_automation_mode, p_provider, 'active', 1)
  ON CONFLICT (org_id, contact_identity, channel) WHERE status = 'active' DO NOTHING
  RETURNING co.id, co.owner_user_id, co.version INTO v_id, v_owner, v_version;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.conversation_ownership_events
      (org_id, ownership_id, lead_id, contact_identity, channel, kind,
       from_user_id, to_user_id, from_version, to_version, reason, actor_user_id, actor_source)
    VALUES
      (p_org_id, v_id, p_lead_id, p_contact_identity, p_channel, 'claim',
       NULL, p_user_id, NULL, v_version, p_reason, p_actor_user_id, p_actor_source);
    RETURN QUERY SELECT 'claimed'::text, v_id, v_owner, v_version;
    RETURN;
  END IF;

  SELECT co.id, co.owner_user_id, co.version INTO v_id, v_owner, v_version
  FROM public.conversation_ownership co
  WHERE co.org_id = p_org_id AND co.contact_identity = p_contact_identity
    AND co.channel = p_channel AND co.status = 'active';

  IF v_id IS NULL THEN
    -- Dono liberado entre o INSERT e o SELECT: o chamador pode tentar de novo.
    RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  IF v_owner IS NOT DISTINCT FROM p_user_id THEN
    RETURN QUERY SELECT 'already_owner'::text, v_id, v_owner, v_version;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, v_id, v_owner, v_version;
  END IF;
END;
$$;

-- 7. RPC transfer_conversation_ownership ---------------------------------------
-- CAS por version. p_to_user_id NULL libera a conversa (status 'released').
-- outcome: 'transferred' | 'released' | 'version_conflict' | 'not_found'
CREATE OR REPLACE FUNCTION public.transfer_conversation_ownership(
  p_org_id           uuid,
  p_contact_identity text,
  p_channel          text,
  p_expected_version integer,
  p_to_user_id       uuid,
  p_reason           text,
  p_actor_user_id    uuid DEFAULT NULL,
  p_actor_source     text DEFAULT 'app'
)
RETURNS TABLE (outcome text, ownership_id uuid, owner_user_id uuid, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_row public.conversation_ownership%ROWTYPE;
  v_prev_owner uuid;
  v_kind text;
BEGIN
  SELECT co.owner_user_id INTO v_prev_owner
  FROM public.conversation_ownership co
  WHERE co.org_id = p_org_id AND co.contact_identity = p_contact_identity
    AND co.channel = p_channel AND co.status = 'active';

  UPDATE public.conversation_ownership co
  SET owner_user_id = p_to_user_id,
      status = CASE WHEN p_to_user_id IS NULL THEN 'released' ELSE 'active' END,
      version = co.version + 1
  WHERE co.org_id = p_org_id AND co.contact_identity = p_contact_identity
    AND co.channel = p_channel AND co.status = 'active'
    AND co.version = p_expected_version
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.conversation_ownership co
      WHERE co.org_id = p_org_id AND co.contact_identity = p_contact_identity
        AND co.channel = p_channel AND co.status = 'active'
    ) THEN
      RETURN QUERY SELECT 'version_conflict'::text, NULL::uuid, NULL::uuid, NULL::integer;
    ELSE
      RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::uuid, NULL::integer;
    END IF;
    RETURN;
  END IF;

  v_kind := CASE WHEN p_to_user_id IS NULL THEN 'release' ELSE 'transfer' END;

  INSERT INTO public.conversation_ownership_events
    (org_id, ownership_id, lead_id, contact_identity, channel, kind,
     from_user_id, to_user_id, from_version, to_version, reason, actor_user_id, actor_source)
  VALUES
    (p_org_id, v_row.id, v_row.lead_id, p_contact_identity, p_channel, v_kind,
     v_prev_owner, p_to_user_id, p_expected_version, v_row.version, p_reason,
     p_actor_user_id, p_actor_source);

  RETURN QUERY SELECT
    CASE WHEN p_to_user_id IS NULL THEN 'released' ELSE 'transferred' END,
    v_row.id, v_row.owner_user_id, v_row.version;
END;
$$;

-- RPCs: somente service_role (o servico valida a organizacao do ator).
REVOKE EXECUTE ON FUNCTION public.claim_conversation_ownership(uuid, uuid, text, text, uuid, uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_conversation_ownership(uuid, text, text, integer, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_ownership(uuid, uuid, text, text, uuid, uuid, text, text, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_conversation_ownership(uuid, text, text, integer, uuid, text, uuid, text)
  TO service_role;

-- 8. Flag (nasce DESLIGADA; escopo global como as demais flags de app_flags) ---
INSERT INTO public.app_flags (key, enabled, note)
VALUES ('conversation_ownership_v1', false, 'PR05: escrita de ownership de conversa e consentimento')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

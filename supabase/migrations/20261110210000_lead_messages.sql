BEGIN;

-- Conversas de WhatsApp e e-mail entre lead e SDR, em tabela própria.
-- Aditiva: não altera interactions, políticas existentes nem webhooks.
-- A flag nasce desligada. Nada é lido enquanto lead_messages_capture
-- estiver desligada para a organização. Não aplica sozinha em produção.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'lead_messages_capture',
  false,
  'Grava WhatsApp e e-mail do lead em lead_messages. Desligada: o histórico segue interactions. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas).',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lead_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_contact_id uuid REFERENCES public.lead_contacts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider text NOT NULL CHECK (provider IN ('evolution', 'meta', 'gmail', 'ana_n8n', 'legacy_interactions')),
  connection_id text,
  our_address text,
  lead_address text,
  body_text text,
  body_html text,
  subject text,
  media jsonb,
  provider_message_id text NOT NULL,
  thread_id text,
  rfc_message_id text,
  sent_by uuid,
  ai_generated boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_messages_provider_message_unique UNIQUE (org_id, provider, provider_message_id),
  CONSTRAINT lead_messages_media_no_file CHECK (
    media IS NULL
    OR (
      jsonb_typeof(media) = 'object'
      AND NOT (media ? 'url')
      AND NOT (media ? 'base64')
      AND NOT (media ? 'bytes')
    )
  )
);

COMMENT ON TABLE public.lead_messages IS 'Conversas de WhatsApp e e-mail do lead. Corpo é append-only. Sem download de mídia.';
COMMENT ON COLUMN public.lead_messages.media IS 'Metadado: type, provider_media_id, mime. Sem arquivo, URL ou base64.';
COMMENT ON COLUMN public.lead_messages.provider_message_id IS 'Id do provedor. Com org_id e provider, impede gravar a mesma mensagem duas vezes.';

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_channel
  ON public.lead_messages (org_id, lead_id, channel, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.lead_message_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.lead_messages(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_message_status_events_once UNIQUE (message_id, status)
);

COMMENT ON TABLE public.lead_message_status_events IS 'Status de entrega, só append. Não reescreve o corpo da mensagem.';

CREATE INDEX IF NOT EXISTS idx_lead_message_status_message
  ON public.lead_message_status_events (message_id, occurred_at DESC);

-- Mensagem que chegou sem lead correspondente. Não aponta para lead.
CREATE TABLE IF NOT EXISTS public.lead_message_unmatched (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  provider text NOT NULL CHECK (provider IN ('evolution', 'meta', 'gmail', 'ana_n8n')),
  connection_id text,
  our_address text,
  their_address text,
  body_text text,
  media jsonb,
  provider_message_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_message_unmatched_provider_unique UNIQUE (org_id, provider, provider_message_id),
  CONSTRAINT lead_message_unmatched_media_no_file CHECK (
    media IS NULL
    OR (
      jsonb_typeof(media) = 'object'
      AND NOT (media ? 'url')
      AND NOT (media ? 'base64')
      AND NOT (media ? 'bytes')
    )
  )
);

COMMENT ON TABLE public.lead_message_unmatched IS 'Quarentena de mensagem sem lead único. Não entra no histórico do lead.';

CREATE OR REPLACE FUNCTION public.reject_lead_message_body_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lead_messages body is append-only';
  END IF;
  IF NEW.body_text IS DISTINCT FROM OLD.body_text OR NEW.body_html IS DISTINCT FROM OLD.body_html THEN
    RAISE EXCEPTION 'lead_messages body is append-only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_messages_body_append_only ON public.lead_messages;
CREATE TRIGGER lead_messages_body_append_only
  BEFORE UPDATE OR DELETE ON public.lead_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_lead_message_body_mutation();

CREATE OR REPLACE FUNCTION public.reject_lead_message_status_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_message_status_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS lead_message_status_events_no_mutation ON public.lead_message_status_events;
CREATE TRIGGER lead_message_status_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.lead_message_status_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_lead_message_status_mutation();

CREATE OR REPLACE FUNCTION public.reject_lead_message_unmatched_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_message_unmatched is append-only';
END;
$$;

DROP TRIGGER IF EXISTS lead_message_unmatched_no_mutation ON public.lead_message_unmatched;
CREATE TRIGGER lead_message_unmatched_no_mutation
  BEFORE UPDATE OR DELETE ON public.lead_message_unmatched
  FOR EACH ROW EXECUTE FUNCTION public.reject_lead_message_unmatched_mutation();

ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_status_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_unmatched ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_unmatched FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_messages_org_read ON public.lead_messages;
CREATE POLICY lead_messages_org_read ON public.lead_messages
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.user_org_id())
    AND (
      (SELECT public.is_manager())
      OR (SELECT public.lead_visibility_mode()) = 'all'
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_messages.lead_id)
    )
  );

DROP POLICY IF EXISTS lead_message_status_events_org_read ON public.lead_message_status_events;
CREATE POLICY lead_message_status_events_org_read ON public.lead_message_status_events
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.user_org_id())
    AND EXISTS (
      SELECT 1 FROM public.lead_messages m
      WHERE m.id = lead_message_status_events.message_id
    )
  );

DROP POLICY IF EXISTS lead_message_unmatched_manager_read ON public.lead_message_unmatched;
CREATE POLICY lead_message_unmatched_manager_read ON public.lead_message_unmatched
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.user_org_id())
    AND (SELECT public.is_manager())
  );

REVOKE ALL ON TABLE public.lead_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lead_message_status_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lead_message_unmatched FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, org_id, lead_id, lead_contact_id, channel, direction, provider, connection_id,
  our_address, lead_address, body_text, body_html, subject, media, provider_message_id,
  thread_id, rfc_message_id, sent_by, ai_generated, occurred_at, created_at
) ON public.lead_messages TO authenticated;

GRANT SELECT (
  id, org_id, message_id, status, occurred_at, created_at
) ON public.lead_message_status_events TO authenticated;

GRANT SELECT (
  id, org_id, channel, provider, connection_id, our_address, their_address,
  body_text, media, provider_message_id, occurred_at, reason, created_at
) ON public.lead_message_unmatched TO authenticated;

GRANT SELECT, INSERT ON public.lead_messages TO service_role;
GRANT SELECT, INSERT ON public.lead_message_status_events TO service_role;
GRANT SELECT, INSERT ON public.lead_message_unmatched TO service_role;

COMMIT;

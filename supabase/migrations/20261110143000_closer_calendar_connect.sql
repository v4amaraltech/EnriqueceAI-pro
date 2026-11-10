BEGIN;

-- Convite para o closer conectar a agenda Google sem conta na plataforma.
-- Flag nasce desligada. Nada aqui é lido enquanto closer_calendar_connect
-- estiver desligada para a organização. Não aplica sozinha em produção.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'closer_calendar_connect',
  false,
  'Convite para o closer conectar a propria agenda Google. Desligada: o agendamento segue lendo a agenda pelo Google do SDR. Para ligar uma org, acrescente o uuid em allow_org_ids. Nao marque enabled = true (ligaria todas).',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.closer_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  closer_id uuid NOT NULL REFERENCES public.closers(id) ON DELETE CASCADE,
  calendar_email text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('connected', 'error')),
  status_detail text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, closer_id)
);

CREATE TABLE IF NOT EXISTS public.closer_calendar_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  closer_id uuid NOT NULL REFERENCES public.closers(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  oauth_state_hash text,
  oauth_state_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS closer_calendar_invites_token_hash
  ON public.closer_calendar_invites (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS closer_calendar_invites_one_open
  ON public.closer_calendar_invites (closer_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS closer_calendar_invites_org_closer
  ON public.closer_calendar_invites (org_id, closer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.closer_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  closer_id uuid NOT NULL REFERENCES public.closers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'invite_sent',
    'invite_resent',
    'invite_revoked',
    'invite_send_failed',
    'connected',
    'connection_error'
  )),
  detail text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS closer_calendar_events_org_closer
  ON public.closer_calendar_events (org_id, closer_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.closer_calendar_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.closer_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.reject_closer_calendar_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'closer_calendar_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS closer_calendar_events_no_mutation ON public.closer_calendar_events;
CREATE TRIGGER closer_calendar_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.closer_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_closer_calendar_event_mutation();

ALTER TABLE public.closer_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closer_calendar_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.closer_calendar_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closer_calendar_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.closer_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closer_calendar_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closer_calendar_connections_manager_read ON public.closer_calendar_connections;
CREATE POLICY closer_calendar_connections_manager_read
  ON public.closer_calendar_connections
  FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_manager());

DROP POLICY IF EXISTS closer_calendar_invites_manager_read ON public.closer_calendar_invites;
CREATE POLICY closer_calendar_invites_manager_read
  ON public.closer_calendar_invites
  FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_manager());

DROP POLICY IF EXISTS closer_calendar_events_manager_read ON public.closer_calendar_events;
CREATE POLICY closer_calendar_events_manager_read
  ON public.closer_calendar_events
  FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_manager());

-- Tokens e o hash do convite nao sao legiveis pelo papel da aplicacao.
-- Escrita so pelo service role (sem policy de insert/update/delete).
REVOKE ALL ON TABLE public.closer_calendar_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.closer_calendar_invites FROM anon, authenticated;
REVOKE ALL ON TABLE public.closer_calendar_events FROM anon, authenticated;

GRANT SELECT (
  id,
  org_id,
  closer_id,
  calendar_email,
  status,
  status_detail,
  connected_at,
  last_error_at,
  created_at,
  updated_at
) ON public.closer_calendar_connections TO authenticated;

GRANT SELECT (
  id,
  org_id,
  closer_id,
  expires_at,
  used_at,
  revoked_at,
  created_by,
  created_at
) ON public.closer_calendar_invites TO authenticated;

GRANT SELECT (
  id,
  org_id,
  closer_id,
  kind,
  detail,
  actor_user_id,
  created_at
) ON public.closer_calendar_events TO authenticated;

COMMIT;

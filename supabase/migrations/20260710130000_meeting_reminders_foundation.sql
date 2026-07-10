-- Meeting reminder follow-up — F1 foundation (email-first; whatsapp entra na F2)
-- Config-driven: origem->contexto (reminder_source_context), passos (reminder_steps),
-- log idempotente (meeting_reminder_log) e view v_reminders_due consumida pelo worker.
-- Ground truth (10/07/2026): meeting_starts_at é UTC; meet_link vive em
-- interactions.metadata->>'meet_link'; RLS via public.user_org_id(); lead_status
-- inclui 'won'. Forward-only.

BEGIN;

-- 1. Mapa origem -> contexto -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_source_context (
  org_id      uuid NOT NULL,
  lead_source text NOT NULL,
  context     text NOT NULL CHECK (context IN ('inbound','outbound')),
  PRIMARY KEY (org_id, lead_source)
);

INSERT INTO public.reminder_source_context (org_id, lead_source, context) VALUES
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','Blackbox','inbound'),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','Leadbroker','inbound'),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','Outbound','outbound')
ON CONFLICT (org_id, lead_source) DO NOTHING;

-- 2. Passos da sequência (config) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_steps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  context             text NOT NULL CHECK (context IN ('inbound','outbound')),
  step_order          int  NOT NULL,
  anchor              text NOT NULL DEFAULT 'meeting' CHECK (anchor IN ('meeting','on_book')),
  offset_minutes      int  NOT NULL DEFAULT 0,   -- negativo = antes da reunião
  channel             text NOT NULL CHECK (channel IN ('email','whatsapp')),
  message_template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, context, step_order)
);

-- Seed email-first. message_template_id preenchido na F3 (o worker/cron só
-- entra na F4, então não há disparo até lá). WhatsApp entra na F2.
INSERT INTO public.reminder_steps
  (org_id, context, step_order, anchor, offset_minutes, channel, active) VALUES
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 1,'on_book',    0,'email',true),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 2,'meeting',-1440,'email',true),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 3,'meeting',  -60,'email',true),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','outbound',1,'on_book',    0,'email',true),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','outbound',2,'meeting',-1440,'email',true),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','outbound',3,'meeting', -120,'email',true)
ON CONFLICT (org_id, context, step_order) DO NOTHING;

-- 3. Log de idempotência -----------------------------------------------------
-- meeting_starts_at na chave: reagendar muda o horário -> nova chave -> redispara.
CREATE TABLE IF NOT EXISTS public.meeting_reminder_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  lead_id           uuid NOT NULL,
  reminder_step_id  uuid NOT NULL,
  meeting_starts_at timestamptz NOT NULL,
  channel           text NOT NULL,
  status            text NOT NULL DEFAULT 'sending',  -- sending / sent / failed / skipped
  detail            text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, reminder_step_id, meeting_starts_at)
);

CREATE INDEX IF NOT EXISTS idx_meeting_reminder_log_org_sent
  ON public.meeting_reminder_log (org_id, sent_at DESC);

-- 4. View lida pelo motor ----------------------------------------------------
-- security_invoker: leituras da app respeitam a RLS de leads/interactions do
-- usuário; o worker usa service role (ignora RLS) e vê todas as orgs.
CREATE OR REPLACE VIEW public.v_reminders_due
WITH (security_invoker = true) AS
SELECT * FROM (
  SELECT
    l.org_id,
    l.id                 AS lead_id,
    l.assigned_to        AS sdr_user_id,
    l.first_name,
    l.last_name,
    l.razao_social,
    l.nome_fantasia,
    l.email,
    l.meeting_scheduled_at,
    l.meeting_starts_at,
    mi.meet_link,
    mi.calendar_event_id,
    rs.id                AS reminder_step_id,
    rs.context,
    rs.step_order,
    rs.channel,
    rs.message_template_id,
    CASE rs.anchor
      WHEN 'on_book' THEN l.meeting_scheduled_at + make_interval(mins => rs.offset_minutes)
      ELSE                l.meeting_starts_at    + make_interval(mins => rs.offset_minutes)
    END AS fire_at
  FROM public.leads l
  JOIN public.reminder_source_context m
    ON m.org_id = l.org_id AND m.lead_source = l.lead_source
  JOIN public.reminder_steps rs
    ON rs.org_id = l.org_id AND rs.context = m.context AND rs.active
  LEFT JOIN LATERAL (
    SELECT i.metadata->>'meet_link'         AS meet_link,
           i.metadata->>'calendar_event_id' AS calendar_event_id
    FROM public.interactions i
    WHERE i.lead_id = l.id AND i.type = 'meeting_scheduled'
    ORDER BY i.created_at DESC
    LIMIT 1
  ) mi ON true
  WHERE l.meeting_starts_at IS NOT NULL
    AND l.meeting_starts_at > now()
    AND l.meeting_held_at IS NULL
    AND l.deleted_at IS NULL
    AND l.status NOT IN ('archived','unqualified','won')
    AND l.assigned_to IS NOT NULL
    AND (
      rs.channel = 'email'
      AND l.email IS NOT NULL
      AND l.email_bounced_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_reminder_log lg
      WHERE lg.lead_id = l.id
        AND lg.reminder_step_id = rs.id
        AND lg.meeting_starts_at = l.meeting_starts_at
    )
) x
WHERE x.fire_at <= now();

-- 5. RLS org-scoped (motor usa service role e ignora RLS) --------------------
ALTER TABLE public.reminder_source_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_reminder_log    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rsc_org ON public.reminder_source_context;
CREATE POLICY rsc_org ON public.reminder_source_context FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

DROP POLICY IF EXISTS rs_org ON public.reminder_steps;
CREATE POLICY rs_org ON public.reminder_steps FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

DROP POLICY IF EXISTS mrl_org ON public.meeting_reminder_log;
CREATE POLICY mrl_org ON public.meeting_reminder_log FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';

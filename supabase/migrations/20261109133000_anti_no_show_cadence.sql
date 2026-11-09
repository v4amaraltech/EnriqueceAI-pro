BEGIN;

-- Cadência anti no-show. Não liga flag, não altera cron, não mexe em reminder_steps
-- nem nos workflows n8n. Enquanto anti_no_show_cadence estiver desligada para a org,
-- nenhuma linha daqui é lida pelo worker.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'anti_no_show_cadence',
  false,
  'Cadência anti no-show por org. Desligada: a régua reminder_steps segue igual. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas). A virada suprime a régua antiga só para as orgs da lista, no mesmo cron de meeting-reminders, e só se o tick novo concluir.',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.anti_no_show_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('pre_meeting', 'recovery')),
  status text NOT NULL CHECK (status IN ('active', 'completed')),
  meeting_starts_at timestamptz NOT NULL,
  context text NOT NULL CHECK (context IN ('inbound', 'outbound')),
  confirmed_at timestamptz,
  confirmation_source text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  booked_at timestamptz NOT NULL DEFAULT now(),
  recovery_opened_at timestamptz,
  completed_at timestamptz,
  completed_reason text CHECK (
    completed_reason IS NULL OR completed_reason IN (
      'held', 'cancelled', 'won', 'disqualified', 'no_show', 'recovery_exhausted', 'replied', 'superseded'
    )
  ),
  source text NOT NULL CHECK (source IN ('sdr', 'bdr', 'backfill')),
  sdr_user_id uuid,
  calendar_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS anti_no_show_one_active_per_lead
  ON public.anti_no_show_enrollments (lead_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS anti_no_show_enrollments_org_active
  ON public.anti_no_show_enrollments (org_id, meeting_starts_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.anti_no_show_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('pre_meeting', 'recovery')),
  context text NOT NULL CHECK (context IN ('inbound', 'outbound', 'any')),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'phone')),
  mode text NOT NULL CHECK (mode IN ('auto', 'task')),
  anchor text NOT NULL CHECK (anchor IN ('on_book', 'meeting_offset', 'business_clock', 'after_meeting')),
  offset_minutes int,
  business_day_offset int,
  clock_hour int,
  clock_minute int,
  active boolean NOT NULL DEFAULT false,
  only_if_unconfirmed boolean NOT NULL DEFAULT false,
  skip_if_booked_within_hours int,
  min_hours_before_meeting int,
  quiet_hours_exempt boolean NOT NULL DEFAULT false,
  not_before_hour_brt int,
  message_template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, step_key, context)
);

CREATE TABLE IF NOT EXISTS public.anti_no_show_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.anti_no_show_enrollments(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  meeting_starts_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed', 'not_sent', 'cancelled', 'task_open', 'task_done')),
  detail text,
  scheduled_activity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_key, meeting_starts_at)
);

CREATE INDEX IF NOT EXISTS anti_no_show_runs_enrollment
  ON public.anti_no_show_runs (enrollment_id);

-- Tarefas da cadência convivem com retorno e limbo. Sem este valor o insert falha.
ALTER TABLE public.scheduled_activities DROP CONSTRAINT IF EXISTS scheduled_activities_kind_check;
ALTER TABLE public.scheduled_activities
  ADD CONSTRAINT scheduled_activities_kind_check
  CHECK (kind IN ('return', 'limbo_followup', 'anti_no_show'));

-- Seed: automáticos nascem desligados e copiam active + template de reminder_steps
-- no momento em que a migration roda. Não dá UPDATE em reminder_steps.
-- Tarefas (ligações e recuperação) nascem ativas, porque não existiam na régua antiga.
CREATE OR REPLACE FUNCTION public.seed_anti_no_show_steps(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.anti_no_show_steps (
    org_id, step_key, phase, context, channel, mode, anchor,
    offset_minutes, business_day_offset, clock_hour, clock_minute,
    active, only_if_unconfirmed, skip_if_booked_within_hours, min_hours_before_meeting,
    quiet_hours_exempt, not_before_hour_brt
  )
  SELECT p_org, v.step_key, v.phase, v.context, v.channel, v.mode, v.anchor,
         v.offset_minutes, v.business_day_offset, v.clock_hour, v.clock_minute,
         v.active, v.only_if_unconfirmed, v.skip_if_booked_within_hours, v.min_hours_before_meeting,
         v.quiet_hours_exempt, v.not_before_hour_brt
  FROM (VALUES
    ('confirm_email', 'pre_meeting', 'inbound', 'email', 'auto', 'on_book', NULL::int, NULL::int, NULL::int, NULL::int, false, false, NULL::int, NULL::int, false, NULL::int),
    ('confirm_email', 'pre_meeting', 'outbound', 'email', 'auto', 'on_book', NULL, NULL, NULL, NULL, false, false, NULL, NULL, false, NULL),
    ('confirm_whatsapp', 'pre_meeting', 'inbound', 'whatsapp', 'auto', 'on_book', NULL, NULL, NULL, NULL, false, false, NULL, NULL, false, NULL),
    ('confirm_whatsapp', 'pre_meeting', 'outbound', 'whatsapp', 'auto', 'on_book', NULL, NULL, NULL, NULL, false, false, NULL, NULL, false, NULL),
    ('eve_email', 'pre_meeting', 'inbound', 'email', 'auto', 'business_clock', NULL, -1, 10, 0, false, false, 20, 3, false, NULL),
    ('eve_email', 'pre_meeting', 'outbound', 'email', 'auto', 'business_clock', NULL, -1, 10, 0, false, false, 20, 3, false, NULL),
    ('eve_whatsapp', 'pre_meeting', 'inbound', 'whatsapp', 'auto', 'business_clock', NULL, -1, 10, 0, false, false, 20, 3, false, NULL),
    ('eve_whatsapp', 'pre_meeting', 'outbound', 'whatsapp', 'auto', 'business_clock', NULL, -1, 10, 0, false, false, 20, 3, false, NULL),
    ('call_eve', 'pre_meeting', 'any', 'phone', 'task', 'business_clock', NULL, -1, 16, 0, true, true, NULL, 3, false, NULL),
    ('call_3h', 'pre_meeting', 'any', 'phone', 'task', 'meeting_offset', -180, NULL, NULL, NULL, true, true, NULL, 3, false, 9),
    ('email_soon', 'pre_meeting', 'inbound', 'email', 'auto', 'meeting_offset', -60, NULL, NULL, NULL, false, false, NULL, 3, true, NULL),
    ('email_soon', 'pre_meeting', 'outbound', 'email', 'auto', 'meeting_offset', -120, NULL, NULL, NULL, false, false, NULL, 3, true, NULL),
    ('whatsapp_20m', 'pre_meeting', 'inbound', 'whatsapp', 'auto', 'meeting_offset', -20, NULL, NULL, NULL, false, false, NULL, NULL, true, NULL),
    ('whatsapp_20m', 'pre_meeting', 'outbound', 'whatsapp', 'auto', 'meeting_offset', -20, NULL, NULL, NULL, false, false, NULL, NULL, true, NULL),
    ('rec_d0_call', 'recovery', 'any', 'phone', 'task', 'after_meeting', 15, NULL, NULL, NULL, true, false, NULL, NULL, false, NULL),
    ('rec_d1_call', 'recovery', 'any', 'phone', 'task', 'business_clock', NULL, 1, 9, 0, true, false, NULL, NULL, false, NULL),
    ('rec_d2_whatsapp', 'recovery', 'any', 'whatsapp', 'task', 'business_clock', NULL, 2, 10, 0, true, false, NULL, NULL, false, NULL),
    ('rec_d2_email', 'recovery', 'any', 'email', 'task', 'business_clock', NULL, 2, 10, 0, true, false, NULL, NULL, false, NULL),
    ('rec_d4_call', 'recovery', 'any', 'phone', 'task', 'business_clock', NULL, 4, 14, 0, true, false, NULL, NULL, false, NULL),
    ('rec_d7_email', 'recovery', 'any', 'email', 'task', 'business_clock', NULL, 7, 10, 0, true, false, NULL, NULL, false, NULL),
    ('rec_decide', 'recovery', 'any', 'phone', 'task', 'business_clock', NULL, 7, 11, 0, true, false, NULL, NULL, false, NULL)
  ) AS v(
    step_key, phase, context, channel, mode, anchor,
    offset_minutes, business_day_offset, clock_hour, clock_minute,
    active, only_if_unconfirmed, skip_if_booked_within_hours, min_hours_before_meeting,
    quiet_hours_exempt, not_before_hour_brt
  )
  ON CONFLICT (org_id, step_key, context) DO NOTHING;

  -- Copia só o que ainda não tem template, para não desfazer ajuste posterior.
  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'email' AND anchor = 'on_book'
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'confirm_email' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'whatsapp' AND anchor = 'on_book'
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'confirm_whatsapp' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'email' AND anchor = 'meeting' AND offset_minutes = -1440
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'eve_email' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'whatsapp' AND anchor = 'meeting' AND offset_minutes = -1440
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'eve_whatsapp' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'email' AND anchor = 'meeting' AND offset_minutes = -60
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'email_soon' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'email' AND anchor = 'meeting' AND offset_minutes = -120
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'email_soon' AND s.context = src.context AND s.message_template_id IS NULL;

  UPDATE public.anti_no_show_steps s
  SET active = src.active, message_template_id = src.message_template_id
  FROM (
    SELECT DISTINCT ON (context) context, active, message_template_id
    FROM public.reminder_steps
    WHERE org_id = p_org AND channel = 'whatsapp' AND anchor = 'meeting' AND offset_minutes = -20
    ORDER BY context, active DESC, created_at DESC
  ) src
  WHERE s.org_id = p_org AND s.step_key = 'whatsapp_20m' AND s.context = src.context AND s.message_template_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_seed_anti_no_show_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.seed_anti_no_show_steps(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_seed_anti_no_show ON public.organizations;
CREATE TRIGGER organizations_seed_anti_no_show
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_anti_no_show_steps();

DO $$
DECLARE org uuid;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_anti_no_show_steps(org);
  END LOOP;
END $$;

ALTER TABLE public.anti_no_show_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anti_no_show_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anti_no_show_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anti_no_show_enrollments_org ON public.anti_no_show_enrollments;
CREATE POLICY anti_no_show_enrollments_org ON public.anti_no_show_enrollments
  FOR ALL USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

DROP POLICY IF EXISTS anti_no_show_steps_org ON public.anti_no_show_steps;
CREATE POLICY anti_no_show_steps_org ON public.anti_no_show_steps
  FOR ALL USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

DROP POLICY IF EXISTS anti_no_show_runs_org ON public.anti_no_show_runs;
CREATE POLICY anti_no_show_runs_org ON public.anti_no_show_runs
  FOR ALL USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

DROP TRIGGER IF EXISTS set_updated_at ON public.anti_no_show_enrollments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.anti_no_show_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.anti_no_show_steps;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.anti_no_show_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- PR10 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 12):
-- saude e tetos por numero (Evolution).
--
-- Aditiva e forward-only. Nada aqui e lido por caminho de envio enquanto a flag
-- `number_health_v1` (app_flags, global) estiver desligada; ela nasce desligada.
--
-- Principios:
--   * Defaults restritivos: estado 'onboarding', rampa no estagio 0, teto de
--     contatos novos 10 e teto total (incluindo respondentes) 20.
--   * Metricas sao append-only na pratica: contadores so crescem (trigger), nao ha
--     DELETE concedido a ninguem e o FK da instancia nao e CASCADE. Pausa nunca
--     zera tetos, estagio ou metricas.
--   * Sinal ausente e NULL (desconhecido), nunca zero.
--   * Escrita somente via service_role. `authenticated` apenas le a propria org.
--   * Nenhuma coluna ou funcao aqui escolhe, troca ou substitui numero.

BEGIN;

-- 1. whatsapp_instances: estado de saude, tetos e rampa ------------------------
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS health_state TEXT NOT NULL DEFAULT 'onboarding',
  ADD COLUMN IF NOT EXISTS health_pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS health_state_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_total_daily_cap INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS health_new_contacts_daily_cap INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS health_ramp_stage INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_ramp_changed_on DATE,
  ADD COLUMN IF NOT EXISTS health_ramp_frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_ramp_freeze_reason TEXT,
  ADD COLUMN IF NOT EXISTS health_recovered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_ack_window_date DATE,
  ADD COLUMN IF NOT EXISTS health_ack_trusted_reports INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_ack_restrictions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_evaluated_at TIMESTAMPTZ;

ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_health_state_check,
  DROP CONSTRAINT IF EXISTS whatsapp_instances_health_caps_check,
  DROP CONSTRAINT IF EXISTS whatsapp_instances_health_ramp_stage_check;
ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_health_state_check
    CHECK (health_state IN ('onboarding', 'warming', 'healthy', 'degraded', 'paused', 'review')),
  ADD CONSTRAINT whatsapp_instances_health_caps_check
    CHECK (
      health_total_daily_cap BETWEEN 0 AND 1000
      AND health_new_contacts_daily_cap BETWEEN 0 AND 1000
      AND health_new_contacts_daily_cap <= health_total_daily_cap
    ),
  ADD CONSTRAINT whatsapp_instances_health_ramp_stage_check
    CHECK (health_ramp_stage BETWEEN 0 AND 20);

COMMENT ON COLUMN public.whatsapp_instances.health_state IS
  'PR10: onboarding | warming | healthy | degraded | paused | review. paused e review bloqueiam envio e so saem por recuperacao autorizada.';
COMMENT ON COLUMN public.whatsapp_instances.health_total_daily_cap IS
  'PR10: teto diario TOTAL de mensagens do numero, incluindo respondentes (dia de Sao Paulo).';
COMMENT ON COLUMN public.whatsapp_instances.health_new_contacts_daily_cap IS
  'PR10: teto diario de contatos novos (lead que ainda nao respondeu). Sempre <= total.';
COMMENT ON COLUMN public.whatsapp_instances.health_ramp_stage IS
  'PR10: estagio da rampa. So avanca com janelas saudaveis e amostra minima, nunca so por tempo. Pausa nao o reduz.';

-- Guarda: colunas health_* so mudam por service_role (ou dono do banco). Gestor
-- autenticado tem UPDATE na tabela pela RLS antiga e nao pode mexer em tetos,
-- estado ou rampa. Em INSERT por usuario autenticado, volta aos defaults.
CREATE OR REPLACE FUNCTION public.guard_number_health_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.health_state := 'onboarding';
    NEW.health_pause_reason := NULL;
    NEW.health_state_changed_at := NULL;
    NEW.health_total_daily_cap := 20;
    NEW.health_new_contacts_daily_cap := 10;
    NEW.health_ramp_stage := 0;
    NEW.health_ramp_changed_on := NULL;
    NEW.health_ramp_frozen_at := NULL;
    NEW.health_ramp_freeze_reason := NULL;
    NEW.health_recovered_at := NULL;
    NEW.health_ack_window_date := NULL;
    NEW.health_ack_trusted_reports := 0;
    NEW.health_ack_restrictions := 0;
    NEW.health_evaluated_at := NULL;
    RETURN NEW;
  END IF;

  IF (NEW.health_state, NEW.health_pause_reason, NEW.health_state_changed_at,
      NEW.health_total_daily_cap, NEW.health_new_contacts_daily_cap, NEW.health_ramp_stage,
      NEW.health_ramp_changed_on, NEW.health_ramp_frozen_at, NEW.health_ramp_freeze_reason,
      NEW.health_recovered_at, NEW.health_ack_window_date, NEW.health_ack_trusted_reports,
      NEW.health_ack_restrictions, NEW.health_evaluated_at)
     IS DISTINCT FROM
     (OLD.health_state, OLD.health_pause_reason, OLD.health_state_changed_at,
      OLD.health_total_daily_cap, OLD.health_new_contacts_daily_cap, OLD.health_ramp_stage,
      OLD.health_ramp_changed_on, OLD.health_ramp_frozen_at, OLD.health_ramp_freeze_reason,
      OLD.health_recovered_at, OLD.health_ack_window_date, OLD.health_ack_trusted_reports,
      OLD.health_ack_restrictions, OLD.health_evaluated_at)
  THEN
    RAISE EXCEPTION 'colunas de saude do numero so mudam pelo servico' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_number_health_columns ON public.whatsapp_instances;
CREATE TRIGGER guard_number_health_columns
  BEFORE INSERT OR UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.guard_number_health_columns();

-- 2. whatsapp_number_health_windows: agregados por janela (dia de Sao Paulo) ------
CREATE TABLE IF NOT EXISTS public.whatsapp_number_health_windows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NO ACTION (nao CASCADE): apagar o numero nao apaga o historico de saude.
  instance_id          uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  -- Dia no calendario America/Sao_Paulo (UTC-3 fixo, igual a brtDateKey).
  window_date          date NOT NULL,
  sent_new_contacts    integer NOT NULL DEFAULT 0,
  sent_to_respondents  integer NOT NULL DEFAULT 0,
  -- NULL = desconhecido (sem telemetria). Zero so quando alguem reportou zero.
  replies_received     integer,
  failures             integer,
  trusted_reports      integer,
  restriction_events   integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_number_health_windows_nonneg_chk CHECK (
    sent_new_contacts >= 0 AND sent_to_respondents >= 0
    AND (replies_received IS NULL OR replies_received >= 0)
    AND (failures IS NULL OR failures >= 0)
    AND (trusted_reports IS NULL OR trusted_reports >= 0)
    AND (restriction_events IS NULL OR restriction_events >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_number_health_windows_instance_date
  ON public.whatsapp_number_health_windows (instance_id, window_date);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_health_windows_org_date
  ON public.whatsapp_number_health_windows (org_id, window_date DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_number_health_windows;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_number_health_windows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Contadores so crescem; identidade da janela nao muda; desconhecido nao "reaparece".
CREATE OR REPLACE FUNCTION public.guard_number_health_windows_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.instance_id <> OLD.instance_id OR NEW.window_date <> OLD.window_date THEN
    RAISE EXCEPTION 'identidade da janela de saude e imutavel' USING ERRCODE = '23514';
  END IF;
  IF NEW.sent_new_contacts < OLD.sent_new_contacts
     OR NEW.sent_to_respondents < OLD.sent_to_respondents
     OR (OLD.replies_received IS NOT NULL AND (NEW.replies_received IS NULL OR NEW.replies_received < OLD.replies_received))
     OR (OLD.failures IS NOT NULL AND (NEW.failures IS NULL OR NEW.failures < OLD.failures))
     OR (OLD.trusted_reports IS NOT NULL AND (NEW.trusted_reports IS NULL OR NEW.trusted_reports < OLD.trusted_reports))
     OR (OLD.restriction_events IS NOT NULL AND (NEW.restriction_events IS NULL OR NEW.restriction_events < OLD.restriction_events))
  THEN
    RAISE EXCEPTION 'metricas de saude do numero so crescem' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_monotonic ON public.whatsapp_number_health_windows;
CREATE TRIGGER guard_monotonic BEFORE UPDATE ON public.whatsapp_number_health_windows
  FOR EACH ROW EXECUTE FUNCTION public.guard_number_health_windows_monotonic();

ALTER TABLE public.whatsapp_number_health_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_number_health_windows_org_select ON public.whatsapp_number_health_windows;
CREATE POLICY whatsapp_number_health_windows_org_select ON public.whatsapp_number_health_windows
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- Sem DELETE para ninguem. Escrita so service_role.
REVOKE ALL ON public.whatsapp_number_health_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_number_health_windows TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_number_health_windows TO service_role;

-- 3. RPC record_number_health_window --------------------------------------------
-- Soma deltas (>= 0) de forma atomica. Delta NULL = "sem informacao": nao altera o
-- sinal (que continua desconhecido se ainda for NULL). Confere que a instancia e da
-- organizacao. Nunca decrementa, nunca apaga.
CREATE OR REPLACE FUNCTION public.record_number_health_window(
  p_org_id               uuid,
  p_instance_id          uuid,
  p_window_date          date,
  p_sent_new_contacts    integer DEFAULT 0,
  p_sent_to_respondents  integer DEFAULT 0,
  p_replies              integer DEFAULT NULL,
  p_failures             integer DEFAULT NULL,
  p_trusted_reports      integer DEFAULT NULL,
  p_restriction_events   integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF COALESCE(p_sent_new_contacts, 0) < 0 OR COALESCE(p_sent_to_respondents, 0) < 0
     OR COALESCE(p_replies, 0) < 0 OR COALESCE(p_failures, 0) < 0
     OR COALESCE(p_trusted_reports, 0) < 0 OR COALESCE(p_restriction_events, 0) < 0 THEN
    RAISE EXCEPTION 'delta negativo nao e permitido' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances i WHERE i.id = p_instance_id AND i.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'instancia nao pertence a organizacao' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.whatsapp_number_health_windows AS w (
    org_id, instance_id, window_date,
    sent_new_contacts, sent_to_respondents,
    replies_received, failures, trusted_reports, restriction_events
  ) VALUES (
    p_org_id, p_instance_id, p_window_date,
    COALESCE(p_sent_new_contacts, 0), COALESCE(p_sent_to_respondents, 0),
    p_replies, p_failures, p_trusted_reports, p_restriction_events
  )
  ON CONFLICT (instance_id, window_date) DO UPDATE SET
    sent_new_contacts   = w.sent_new_contacts + COALESCE(p_sent_new_contacts, 0),
    sent_to_respondents = w.sent_to_respondents + COALESCE(p_sent_to_respondents, 0),
    replies_received    = CASE WHEN p_replies IS NULL THEN w.replies_received
                               ELSE COALESCE(w.replies_received, 0) + p_replies END,
    failures            = CASE WHEN p_failures IS NULL THEN w.failures
                               ELSE COALESCE(w.failures, 0) + p_failures END,
    trusted_reports     = CASE WHEN p_trusted_reports IS NULL THEN w.trusted_reports
                               ELSE COALESCE(w.trusted_reports, 0) + p_trusted_reports END,
    restriction_events  = CASE WHEN p_restriction_events IS NULL THEN w.restriction_events
                               ELSE COALESCE(w.restriction_events, 0) + p_restriction_events END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_number_health_window(uuid, uuid, date, integer, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_number_health_window(uuid, uuid, date, integer, integer, integer, integer, integer, integer)
  TO service_role;

-- 4. Flag (desligada) -------------------------------------------------------------
-- Escopo global, como as demais flags de app_flags.
INSERT INTO public.app_flags (key, enabled, note)
VALUES
  ('number_health_v1', false, 'PR10: saude e tetos por numero (gateway e dispatcher). Desligada: nenhum efeito')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

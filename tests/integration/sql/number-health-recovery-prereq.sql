-- Dependencias minimas para aplicar as migrations EXATAS de auditoria.
-- Nao e o schema de producao inteiro. Cobre tabelas, enums, grants de papel e
-- constraints que a RPC toca. Limitacoes:
--   * user_org_id() de producao le auth.uid(); aqui le o GUC app.user_org_id
--     para exercitar a policy real criada pela migration.
--   * service_role no Supabase tem BYPASSRLS. O papel e criado aqui com esse
--     atributo. A migration em si nao faz ALTER ROLE.
--   * O corpo de authorize_number_recovery_with_audit nao e copiado: os arquivos
--     em supabase/migrations sao executados em seguida, sem edicao.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER ROLE service_role BYPASSRLS;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE public.member_role AS ENUM ('manager', 'sdr');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE public.member_status AS ENUM ('invited', 'active', 'suspended', 'removed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.member_role NOT NULL,
  status public.member_status NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.app_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  allow_org_ids uuid[] NOT NULL DEFAULT '{}',
  allow_user_ids uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  instance_name text NOT NULL,
  status text NOT NULL DEFAULT 'connecting'
    CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
  auto_send_daily_limit integer NOT NULL DEFAULT 20,
  auto_send_limit_changed_on date,
  auto_send_next_at timestamptz,
  auto_send_consecutive_failures integer NOT NULL DEFAULT 0,
  auto_send_paused_at timestamptz,
  auto_send_pause_reason text,
  health_state text NOT NULL DEFAULT 'onboarding',
  health_pause_reason text,
  health_state_changed_at timestamptz,
  health_total_daily_cap integer NOT NULL DEFAULT 20,
  health_new_contacts_daily_cap integer NOT NULL DEFAULT 10,
  health_ramp_stage integer NOT NULL DEFAULT 0,
  health_ramp_changed_on date,
  health_ramp_frozen_at timestamptz,
  health_ramp_freeze_reason text,
  health_recovered_at timestamptz,
  health_ack_window_date date,
  health_ack_trusted_reports integer NOT NULL DEFAULT 0,
  health_ack_restrictions integer NOT NULL DEFAULT 0,
  health_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_instances_health_state_check
    CHECK (health_state IN ('onboarding', 'warming', 'healthy', 'degraded', 'paused', 'review')),
  CONSTRAINT whatsapp_instances_health_caps_check
    CHECK (
      health_total_daily_cap BETWEEN 0 AND 1000
      AND health_new_contacts_daily_cap BETWEEN 0 AND 1000
      AND health_new_contacts_daily_cap <= health_total_daily_cap
    ),
  CONSTRAINT whatsapp_instances_health_ramp_stage_check
    CHECK (health_ramp_stage BETWEEN 0 AND 20)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_number_health_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  window_date date NOT NULL,
  sent_new_contacts integer NOT NULL DEFAULT 0,
  sent_to_respondents integer NOT NULL DEFAULT 0,
  replies_received integer,
  failures integer,
  trusted_reports integer,
  restriction_events integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, window_date)
);

-- Copiado de 20261107150000_conversation_ownership.sql. A migration de auditoria
-- cria o gatilho antigo em cima desta funcao; a migration de contrato o troca.
CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% e append-only (% bloqueado)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_org_id', true), '')::uuid
$$;

-- Copiado de 20261107200000_number_health.sql. A RPC grava health_* como dono.
CREATE OR REPLACE FUNCTION public.guard_number_health_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
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

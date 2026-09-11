-- Schema MÍNIMO para testar as funções de estatística num Postgres puro
-- (story statistics-rpc-integration-tests). NÃO é migration: só o que
-- get_conversion_universe e get_interaction_counts precisam para rodar com a
-- RLS de verdade. As duas funções em si vêm dos arquivos de migration do repo,
-- aplicados por cima deste arquivo, sem cópia.
--
-- Copiado de PROD (dhkmonctyoaenejemkrt) em 2026-09-11, só leitura, com:
--   enums:     select typname, enumlabel from pg_type join pg_enum ... order by enumsortorder
--   colunas:   information_schema.columns (só as usadas pelas funções e pela RLS)
--   funções:   select pg_get_functiondef(oid) — user_org_id, is_manager, lead_visibility_mode, auth.uid
--   políticas: select tablename, policyname, cmd, roles, qual from pg_policies (SELECT)
-- O teste confere o md5 das funções e das políticas contra os valores de prod
-- desta data (AC7). Mudou RLS / user_org_id / is_manager / lead_visibility_mode
-- dessas tabelas em prod? Atualize este arquivo e os md5 no mesmo PR.

-- ── Papéis e auth.uid() como no Supabase ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── Enums (valores e ordem de prod) ──────────────────────────────────────────
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'won', 'unqualified', 'archived');
CREATE TYPE public.channel_type AS ENUM ('email', 'whatsapp', 'phone', 'linkedin', 'research', 'calendar', 'system', 'crm');
CREATE TYPE public.interaction_type AS ENUM ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'meeting_scheduled', 'crm_synced', 'crm_deal_created');
CREATE TYPE public.member_role AS ENUM ('manager', 'sdr');
CREATE TYPE public.member_status AS ENUM ('invited', 'active', 'suspended', 'removed');

-- ── Tabelas (só as colunas usadas) ───────────────────────────────────────────
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_visibility_mode text NOT NULL DEFAULT 'all'::text
);

CREATE TABLE public.organization_members (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role public.member_role NOT NULL DEFAULT 'sdr'::public.member_role,
  status public.member_status NOT NULL DEFAULT 'invited'::public.member_status,
  accepted_at timestamptz
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  status public.lead_status NOT NULL DEFAULT 'new'::public.lead_status,
  created_by uuid,
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  won_at timestamptz,
  lost_at timestamptz,
  meeting_held_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE public.cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  deleted_at timestamptz
);

CREATE TABLE public.interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  performed_by uuid,
  channel public.channel_type NOT NULL,
  type public.interaction_type NOT NULL,
  cadence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cadence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  cadence_id uuid NOT NULL REFERENCES public.cadences(id),
  enrolled_by uuid,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Funções de org (corpo idêntico ao de prod) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.user_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id FROM organization_members
  WHERE user_id = auth.uid() AND status = 'active'
  ORDER BY accepted_at DESC NULLS LAST
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'manager'
    AND status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.lead_visibility_mode()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lead_visibility_mode
  FROM organizations
  WHERE id = public.user_org_id()
$function$;

-- ── RLS e políticas de leitura (texto de prod) ───────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_member_read ON public.organizations FOR SELECT USING ((id = user_org_id()));
CREATE POLICY members_org_read ON public.organization_members FOR SELECT USING ((org_id = user_org_id()));
CREATE POLICY leads_org_read ON public.leads FOR SELECT USING (((org_id = ( SELECT user_org_id() AS user_org_id)) AND (( SELECT is_manager() AS is_manager) OR (( SELECT lead_visibility_mode() AS lead_visibility_mode) = 'all'::text) OR ((( SELECT lead_visibility_mode() AS lead_visibility_mode) = ANY (ARRAY['own'::text, 'team'::text])) AND (assigned_to = ( SELECT auth.uid() AS uid))))));
CREATE POLICY cadences_org_read ON public.cadences FOR SELECT USING ((org_id = user_org_id()));
CREATE POLICY interactions_org_read ON public.interactions FOR SELECT USING ((org_id = user_org_id()));
CREATE POLICY enrollments_org_read ON public.cadence_enrollments FOR SELECT USING ((org_id = user_org_id()));

-- Como no Supabase: os papéis da API leem as tabelas (a RLS filtra as linhas).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

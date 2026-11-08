-- Schema MÍNIMO para testar a checagem de chamador de
-- get_sdr_atividades_atrasadas_v4 e get_sdr_leads_para_abrir_v2 num Postgres puro.
-- NÃO é migration. As duas funções vêm das migrations do repo, aplicadas por cima
-- deste arquivo como estão (fase 1: 20261108130000; fase 2: 20261108180000).
--
-- Copiado de PROD (dhkmonctyoaenejemkrt) em 2026-11-08, só leitura:
--   public.user_org_id()        → pg_get_functiondef (md5 conferido no teste)
--   public.verify_api_secret()  → igual à migration 20260516161116
-- O que as funções leem por baixo (list_overdue_activities_brt,
-- overdue_cutoff_brt, leads_no_active_enrollment) vira stub simples: o teste é
-- sobre QUEM pode chamar, não sobre a regra de atraso/fila.

-- ── Papéis e auth.* como no Supabase ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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

CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

GRANT USAGE ON SCHEMA auth, public, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

-- ── Enums e tabelas (só as colunas usadas) ───────────────────────────────────
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'won', 'unqualified', 'archived');
CREATE TYPE public.member_role AS ENUM ('manager', 'sdr');
CREATE TYPE public.member_status AS ENUM ('invited', 'active', 'suspended', 'removed');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY
);

CREATE TABLE public.organization_members (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role public.member_role NOT NULL DEFAULT 'sdr'::public.member_role,
  status public.member_status NOT NULL DEFAULT 'invited'::public.member_status,
  accepted_at timestamptz
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  status public.lead_status NOT NULL DEFAULT 'new'::public.lead_status,
  assigned_to uuid,
  deleted_at timestamptz
);

-- Só para a parte "pista 19" da migration da fase 1 aplicar.
CREATE TABLE public.worker_run_state (id int);

-- ── Funções de org (de prod) ────────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION public.user_org_id() TO anon, authenticated, service_role;

-- ── Segredo compartilhado (igual à migration 20260516161116, sem o seed) ────
CREATE TABLE public.api_secrets (
  name text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (name, created_at)
);
ALTER TABLE public.api_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_secrets FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.verify_api_secret(p_name text, p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.api_secrets s
    WHERE s.name = p_name
      AND s.revoked_at IS NULL
      AND s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.verify_api_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_secret(text, text) TO service_role;

-- ── Stubs do que as RPCs leem por baixo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.overdue_cutoff_brt(p_now timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT p_now $$;

-- Stub: todo lead não excluído da org conta como 1 atividade atrasada.
CREATE OR REPLACE FUNCTION public.list_overdue_activities_brt(p_org_id uuid, p_cutoff timestamptz)
RETURNS TABLE(lead_id uuid, assigned_to uuid)
LANGUAGE sql STABLE AS $$
  SELECT l.id, l.assigned_to FROM public.leads l WHERE l.org_id = p_org_id
$$;

-- Stub: nenhum lead tem inscrição ativa.
CREATE VIEW public.leads_no_active_enrollment AS SELECT * FROM public.leads;

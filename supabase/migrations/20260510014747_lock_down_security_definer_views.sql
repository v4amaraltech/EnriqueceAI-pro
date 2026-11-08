-- Restrict the LDR helper views (used by n8n workflows with service_role) so
-- they're no longer reachable via the PostgREST API by anon/authenticated
-- clients. The views were flagged by Supabase's database linter as
-- "security_definer_view" because their SECURITY DEFINER property bypasses
-- the caller's RLS — that's intentional (n8n needs cross-org access), but
-- exposing them through the public API is unnecessary risk.
--
-- service_role keeps full access (the n8n workflows use it).
-- The org_members helper view is included for the same reason; the app
-- queries the underlying organization_members table directly.

DO $$ BEGIN IF to_regclass('public.vw_ldr_dashboard') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_dashboard FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_ldr_dashboard_full') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_dashboard_full FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_ldr_para_avaliar_ia') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_para_avaliar_ia FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_ldr_para_enriquecer') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_para_enriquecer FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_ldr_para_validar_tel') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_para_validar_tel FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_ldr_validados') IS NOT NULL THEN
  REVOKE ALL ON public.vw_ldr_validados FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_proxima_empresa_enriquecer') IS NOT NULL THEN
  REVOKE ALL ON public.vw_proxima_empresa_enriquecer FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.vw_proximo_decisor_para_ligar') IS NOT NULL THEN
  REVOKE ALL ON public.vw_proximo_decisor_para_ligar FROM anon, authenticated;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.org_members') IS NOT NULL THEN
  REVOKE ALL ON public.org_members FROM anon, authenticated;
END IF; END $$;

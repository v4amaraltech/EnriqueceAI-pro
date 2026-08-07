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

REVOKE ALL ON public.vw_ldr_dashboard            FROM anon, authenticated;
REVOKE ALL ON public.vw_ldr_dashboard_full       FROM anon, authenticated;
REVOKE ALL ON public.vw_ldr_para_avaliar_ia      FROM anon, authenticated;
REVOKE ALL ON public.vw_ldr_para_enriquecer      FROM anon, authenticated;
REVOKE ALL ON public.vw_ldr_para_validar_tel     FROM anon, authenticated;
REVOKE ALL ON public.vw_ldr_validados            FROM anon, authenticated;
REVOKE ALL ON public.vw_proxima_empresa_enriquecer FROM anon, authenticated;
REVOKE ALL ON public.vw_proximo_decisor_para_ligar FROM anon, authenticated;
REVOKE ALL ON public.org_members                 FROM anon, authenticated;

-- 29 SECURITY DEFINER public functions were EXECUTE-grantable to the anon
-- role (Supabase advisor: anon_security_definer_function_executable). Most
-- are app-facing helpers, RPCs called by authenticated users, or webhook
-- targets called via service_role — none have a reason to be reachable
-- without authentication.
--
-- The worst offender was get_leads_for_v4sales(): SECURITY DEFINER + an
-- org_id hardcoded inside the function body + EXECUTE TO anon. Anyone
-- with the project's public REST URL could POST /rest/v1/rpc/get_leads_for_v4sales
-- with no auth header and download every lead's CNPJ, email, phone,
-- contact name and pipeline status. LGPD + commercial-data exposure.
--
-- This migration only REVOKEs EXECUTE FROM anon and PUBLIC. authenticated
-- and service_role grants are preserved so the app and Edge Functions
-- keep working. Functions invoked exclusively from triggers are unaffected
-- (triggers fire with the calling user's privileges, not anon).
--
-- If/when the V4 Sales integration needs access, it should authenticate
-- with the service_role key (server-side) rather than rely on anon execute.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.auto_enroll_ldr_autonomo() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.buscar_decisor_empresa(p_empresa_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.buscar_empresa_validada_para_distribuir() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_events() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_activities_by_performer(p_org_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_cadence_ids uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_leads_by_status(p_org_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_conversion_ranking_data(p_org_id uuid, p_start timestamp with time zone, p_end timestamp with time zone) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_inactive_enrollment_candidates() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_overdue_manual_activities() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(p_year integer, p_month integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(p_from_date text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_distinct_lead_canais() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_distinct_lead_cnaes() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_executed_steps(p_cadence_ids uuid[], p_step_ids uuid[], p_lead_ids uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_indicacoes_ranking(p_year integer, p_month integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leads_for_v4sales(p_from_date text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sdr_monthly_metrics() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lead_visibility_mode() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leads_without_active_enrollment(p_org_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_empresa_distribuida(p_empresa_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.processar_resultado_ligacao(p_call_id text, p_call_status text, p_disconnection_reason text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_calls_to_v4sales(p_year integer, p_month integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalc_engagement_score(p_lead_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_recalc_engagement_score() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_call_from_webhook(p_api4com_call_id text, p_record_url text, p_duration integer, p_started_at timestamp with time zone) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_socio_lemit(p_empresa_id text, p_cnpj text, p_nome_socio text, p_posicao integer, p_eh_pj boolean, p_telefone text, p_email text, p_whatsapp boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_org_id() FROM anon, PUBLIC;

COMMIT;

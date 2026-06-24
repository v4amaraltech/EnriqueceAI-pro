-- Consolidates three migrations whose REVOKE blocks never reached
-- production: 20260512180000_revoke_anon_execute_definer_fns,
-- 20260513090000_revoke_authenticated_execute_on_internal_definer_fns,
-- 20260515080000_harden_rpc_security_definer (all deleted from the repo
-- because the CREATE OR REPLACE bodies in the third one would have
-- regressed the dashboard fixed by 20260515200000_rpc_service_role_bypass).
--
-- Scope: revoke EXECUTE on SECURITY DEFINER helpers from anon + PUBLIC
-- and from authenticated for trigger/webhook/cron-only functions
-- (functions with no supabase.rpc() callsite in src/).
--
-- get_leads_for_v4sales and get_indicacoes_ranking are re-granted to anon
-- in the very next migrations (160526, 161116) — they are intentionally
-- public for the v4-sales-frontend ranking page, gated by a shared secret
-- introduced in 20260516161116_protect_public_rpcs_with_shared_secret.

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
REVOKE EXECUTE ON FUNCTION public.recalc_engagement_score(p_lead_id uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_recalc_engagement_score() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_call_from_webhook(p_api4com_call_id text, p_record_url text, p_duration integer, p_started_at timestamp with time zone) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_socio_lemit(p_empresa_id text, p_cnpj text, p_nome_socio text, p_posicao integer, p_eh_pj boolean, p_telefone text, p_email text, p_whatsapp boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_org_id() FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recalc_engagement_score() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_enroll_ldr_autonomo() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_engagement_score(p_lead_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_call_from_webhook(p_api4com_call_id text, p_record_url text, p_duration integer, p_started_at timestamp with time zone) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.processar_resultado_ligacao(p_call_id text, p_call_status text, p_disconnection_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_socio_lemit(p_empresa_id text, p_cnpj text, p_nome_socio text, p_posicao integer, p_eh_pj boolean, p_telefone text, p_email text, p_whatsapp boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_events() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.buscar_decisor_empresa(p_empresa_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.buscar_empresa_validada_para_distribuir() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_empresa_distribuida(p_empresa_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_leads_for_v4sales(p_from_date text) FROM authenticated;

COMMIT;

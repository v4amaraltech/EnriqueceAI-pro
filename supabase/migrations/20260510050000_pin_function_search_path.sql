-- Pin search_path on every function flagged by the linter as
-- function_search_path_mutable. With a mutable search_path, a caller can
-- shadow public.* with a malicious schema before invoking a SECURITY DEFINER
-- function. Setting search_path to (public, pg_catalog) defends against
-- that without changing the function bodies.

ALTER FUNCTION public.auto_skip_ineligible_call_transcription() SET search_path = public, pg_catalog;
ALTER FUNCTION public.buscar_decisor_empresa(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.buscar_empresa_validada_para_distribuir() SET search_path = public, pg_catalog;
ALTER FUNCTION public.buscar_proximo_decisor_para_ligar() SET search_path = public, pg_catalog;
ALTER FUNCTION public.calculate_engagement_score(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.calculate_next_step_due() SET search_path = public, pg_catalog;
ALTER FUNCTION public.cleanup_provider_events() SET search_path = public, pg_catalog;
ALTER FUNCTION public.complete_enrollments_on_cadence_delete() SET search_path = public, pg_catalog;
ALTER FUNCTION public.count_activities_by_performer(uuid, timestamptz, timestamptz, uuid[]) SET search_path = public, pg_catalog;
ALTER FUNCTION public.count_leads_by_status(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.fetch_conversion_ranking_data(uuid, timestamptz, timestamptz) SET search_path = public, pg_catalog;
ALTER FUNCTION public.gerar_nome_curto(text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.gerar_nome_curto_socio(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_calls_for_v4sales(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_calls_for_v4sales(integer, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_executed_steps(uuid[], uuid[], uuid[]) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_leads_for_v4sales(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_sdr_monthly_metrics() SET search_path = public, pg_catalog;
ALTER FUNCTION public.leads_without_active_enrollment(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.marcar_empresa_distribuida(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.processar_resultado_ligacao(text, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.push_calls_to_v4sales(integer, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.registrar_tentativa_ligacao(uuid, uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_qualified_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_set_nome_curto() SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_set_nome_curto_socio() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_call_from_webhook(text, text, integer, timestamptz) SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_catalog;

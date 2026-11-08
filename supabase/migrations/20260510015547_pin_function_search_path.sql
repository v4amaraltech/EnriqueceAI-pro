-- Pin search_path on every function flagged by the linter as
-- function_search_path_mutable. With a mutable search_path, a caller can
-- shadow public.* with a malicious schema before invoking a SECURITY DEFINER
-- function. Setting search_path to (public, pg_catalog) defends against
-- that without changing the function bodies.

DO $$ BEGIN IF to_regprocedure('public.auto_skip_ineligible_call_transcription()') IS NOT NULL THEN
  ALTER FUNCTION public.auto_skip_ineligible_call_transcription() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.buscar_decisor_empresa(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.buscar_decisor_empresa(uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.buscar_empresa_validada_para_distribuir()') IS NOT NULL THEN
  ALTER FUNCTION public.buscar_empresa_validada_para_distribuir() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.buscar_proximo_decisor_para_ligar()') IS NOT NULL THEN
  ALTER FUNCTION public.buscar_proximo_decisor_para_ligar() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.calculate_engagement_score(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.calculate_engagement_score(uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.calculate_next_step_due()') IS NOT NULL THEN
  ALTER FUNCTION public.calculate_next_step_due() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.cleanup_provider_events()') IS NOT NULL THEN
  ALTER FUNCTION public.cleanup_provider_events() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.complete_enrollments_on_cadence_delete()') IS NOT NULL THEN
  ALTER FUNCTION public.complete_enrollments_on_cadence_delete() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.count_activities_by_performer(uuid, timestamptz, timestamptz, uuid[])') IS NOT NULL THEN
  ALTER FUNCTION public.count_activities_by_performer(uuid, timestamptz, timestamptz, uuid[]) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.count_leads_by_status(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.count_leads_by_status(uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.fetch_conversion_ranking_data(uuid, timestamptz, timestamptz)') IS NOT NULL THEN
  ALTER FUNCTION public.fetch_conversion_ranking_data(uuid, timestamptz, timestamptz) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.gerar_nome_curto(text, text)') IS NOT NULL THEN
  ALTER FUNCTION public.gerar_nome_curto(text, text) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.gerar_nome_curto_socio(text)') IS NOT NULL THEN
  ALTER FUNCTION public.gerar_nome_curto_socio(text) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_calls_for_v4sales(text)') IS NOT NULL THEN
  ALTER FUNCTION public.get_calls_for_v4sales(text) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_calls_for_v4sales(integer, integer)') IS NOT NULL THEN
  ALTER FUNCTION public.get_calls_for_v4sales(integer, integer) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_executed_steps(uuid[], uuid[], uuid[])') IS NOT NULL THEN
  ALTER FUNCTION public.get_executed_steps(uuid[], uuid[], uuid[]) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_leads_for_v4sales(text)') IS NOT NULL THEN
  ALTER FUNCTION public.get_leads_for_v4sales(text) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.get_sdr_monthly_metrics()') IS NOT NULL THEN
  ALTER FUNCTION public.get_sdr_monthly_metrics() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.leads_without_active_enrollment(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.leads_without_active_enrollment(uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.marcar_empresa_distribuida(uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.marcar_empresa_distribuida(uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.processar_resultado_ligacao(text, text, text)') IS NOT NULL THEN
  ALTER FUNCTION public.processar_resultado_ligacao(text, text, text) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.push_calls_to_v4sales(integer, integer)') IS NOT NULL THEN
  ALTER FUNCTION public.push_calls_to_v4sales(integer, integer) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.registrar_tentativa_ligacao(uuid, uuid)') IS NOT NULL THEN
  ALTER FUNCTION public.registrar_tentativa_ligacao(uuid, uuid) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.set_qualified_at()') IS NOT NULL THEN
  ALTER FUNCTION public.set_qualified_at() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.trg_set_nome_curto()') IS NOT NULL THEN
  ALTER FUNCTION public.trg_set_nome_curto() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.trg_set_nome_curto_socio()') IS NOT NULL THEN
  ALTER FUNCTION public.trg_set_nome_curto_socio() SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.update_call_from_webhook(text, text, integer, timestamptz)') IS NOT NULL THEN
  ALTER FUNCTION public.update_call_from_webhook(text, text, integer, timestamptz) SET search_path = public, pg_catalog;
END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.update_updated_at()') IS NOT NULL THEN
  ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_catalog;
END IF; END $$;

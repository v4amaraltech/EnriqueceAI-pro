-- 27 SECURITY DEFINER public functions were callable by the `authenticated`
-- role via /rest/v1/rpc/<fn>. Supabase advisor surfaced these as
-- authenticated_security_definer_function_executable.
--
-- After migration 20260512180000 revoked anon EXECUTE, this is the second
-- layer: most of these are either trigger functions, webhook handlers, or
-- internal helpers that have no business being exposed as REST endpoints.
-- Service role keeps EXECUTE so cron / edge / webhook code keeps working.
--
-- DELIBERATELY KEPT for authenticated:
--   public.is_manager()           — referenced inside RLS policies; the
--   public.user_org_id()            Postgres planner invokes these as the
--   public.lead_visibility_mode()   `authenticated` role and revoking
--                                   EXECUTE would lock the whole app out.
--   public.count_*, get_*, fetch_* — wrapped by supabase.rpc() calls in
--                                   actions (counters, distinct values,
--                                   ranking, monthly metrics). Confirmed
--                                   in app code via grep.
--
-- The functions below have NO supabase.rpc() callsite in src/ and are only
-- entered through SQL triggers, cron commands, edge functions, or webhook
-- routes that already authenticate via service_role.

BEGIN;

-- Auth + trigger functions (Supabase invokes these implicitly, never via REST)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recalc_engagement_score() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_enroll_ldr_autonomo() FROM authenticated;

-- Engagement scoring helper — called by the trigger above, never directly by the app
REVOKE EXECUTE ON FUNCTION public.recalc_engagement_score(p_lead_id uuid) FROM authenticated;

-- Webhook / cron helpers (service_role only)
REVOKE EXECUTE ON FUNCTION public.update_call_from_webhook(p_api4com_call_id text, p_record_url text, p_duration integer, p_started_at timestamp with time zone) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.processar_resultado_ligacao(p_call_id text, p_call_status text, p_disconnection_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_socio_lemit(p_empresa_id text, p_cnpj text, p_nome_socio text, p_posicao integer, p_eh_pj boolean, p_telefone text, p_email text, p_whatsapp boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_events() FROM authenticated;

-- LDR Autônomo helpers — only invoked by n8n / service-role flows
REVOKE EXECUTE ON FUNCTION public.buscar_decisor_empresa(p_empresa_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.buscar_empresa_validada_para_distribuir() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_empresa_distribuida(p_empresa_id uuid) FROM authenticated;

-- V4 Sales integration — should authenticate with service_role key, not the
-- end-user session. Already revoked from anon in 20260512180000.
REVOKE EXECUTE ON FUNCTION public.push_calls_to_v4sales(p_year integer, p_month integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(p_from_date text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(p_year integer, p_month integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_leads_for_v4sales(p_from_date text) FROM authenticated;

COMMIT;

-- Revoke EXECUTE from `authenticated` on SECURITY DEFINER RPCs that have
-- no business being called by a signed-in user via PostgREST. The Supabase
-- advisor flags any public-schema SECURITY DEFINER function as exposed via
-- /rest/v1/rpc by default — for these four, the only legitimate caller is
-- the app's server-side code running under service_role.
--
-- Per-RPC justification (validated against src/ on 2026-05-16):
--
-- - count_activities_by_performer / fetch_conversion_ranking_data:
--   called by ranking-metrics.service.ts via get-ranking-data.ts, which
--   uses createServiceRoleClient(). authenticated has no caller.
--
-- - get_sdr_monthly_metrics / leads_without_active_enrollment:
--   no callers in src/ at all. Likely vestigial from feature work that
--   moved to direct queries. Lock down execute until something legitimate
--   needs it.
--
-- NOT revoking (have authenticated callers):
--   count_leads_by_status, get_distinct_lead_canais, get_distinct_lead_cnaes,
--   get_executed_steps — fetch-leads.ts and fetch-pending-activities.ts
--   call these with the user's session.
--
-- NOT revoking (RLS helpers used in policies):
--   is_manager, user_org_id, lead_visibility_mode.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.count_activities_by_performer(uuid, timestamptz, timestamptz, uuid[])
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_activities_by_performer(uuid, timestamptz, timestamptz, uuid[])
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fetch_conversion_ranking_data(uuid, timestamptz, timestamptz)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_conversion_ranking_data(uuid, timestamptz, timestamptz)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_sdr_monthly_metrics()
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sdr_monthly_metrics()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.leads_without_active_enrollment(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.leads_without_active_enrollment(uuid)
  TO service_role;

COMMIT;

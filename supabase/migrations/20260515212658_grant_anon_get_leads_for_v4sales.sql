-- Intentional anon exposure for the upcoming v4-sales-frontend public
-- page. Original grant — superseded by the shared-secret gate in
-- 20260516161116_protect_public_rpcs_with_shared_secret which drops
-- this function and rebuilds it with a required p_api_token parameter.

GRANT EXECUTE ON FUNCTION public.get_leads_for_v4sales(text) TO anon;

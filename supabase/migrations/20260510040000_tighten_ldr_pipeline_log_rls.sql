-- Tighten RLS on ldr_pipeline_log. Two permissive policies (allow_insert,
-- allow_select) had WITH CHECK / USING set to plain `true`, which OR'd with
-- the existing `service_role_only` policy and effectively granted INSERT and
-- SELECT to anon + authenticated through the PostgREST API. The n8n LDR
-- pipeline talks to this table with service_role only, so dropping the two
-- permissive policies leaves the existing service_role_only ALL policy as
-- the single gate.

DROP POLICY IF EXISTS allow_insert_pipeline_log ON public.ldr_pipeline_log;
DROP POLICY IF EXISTS allow_select_pipeline_log ON public.ldr_pipeline_log;

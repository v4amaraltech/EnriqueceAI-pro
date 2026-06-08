-- Fix critical security: enable RLS on tables that were publicly accessible
ALTER TABLE ldr_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ldr_pipeline_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ldr_socios ENABLE ROW LEVEL SECURITY;

-- Restrictive policies: only service_role can access
CREATE POLICY "service_role_only" ON ldr_empresas FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON ldr_pipeline_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON ldr_socios FOR ALL USING (auth.role() = 'service_role');

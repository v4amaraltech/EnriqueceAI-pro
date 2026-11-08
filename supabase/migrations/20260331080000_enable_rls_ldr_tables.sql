-- Fix critical security: enable RLS on tables that were publicly accessible
-- Cada statement é guardado individualmente: as tabelas ldr_* não existem mais em
-- bancos novos (removidas em produção); nesse caso os statements são no-op.
DO $$ BEGIN
  IF to_regclass('public.ldr_empresas') IS NOT NULL THEN
    ALTER TABLE ldr_empresas ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ldr_pipeline_log') IS NOT NULL THEN
    ALTER TABLE ldr_pipeline_log ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ldr_socios') IS NOT NULL THEN
    ALTER TABLE ldr_socios ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Restrictive policies: only service_role can access
DO $$ BEGIN
  IF to_regclass('public.ldr_empresas') IS NOT NULL THEN
    CREATE POLICY "service_role_only" ON ldr_empresas FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ldr_pipeline_log') IS NOT NULL THEN
    CREATE POLICY "service_role_only" ON ldr_pipeline_log FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ldr_socios') IS NOT NULL THEN
    CREATE POLICY "service_role_only" ON ldr_socios FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Correções de segurança em objetos que existem só em produção (pista 4 da auditoria).
-- Idempotente, forward-only. Cada objeto tem guarda de existência (pode não existir local).
--
-- NÃO redefine corpos de função. As RPCs get_indicacoes_ranking,
-- get_indicacoes_leads_lookup, get_indicacoes_reunioes_realizadas e
-- get_sdr_leads_abertos(int,int) existem só em produção e ficam FORA desta migration:
-- seus corpos precisam de revisão manual (ver descrição do PR).

BEGIN;

-- 1. consentimento_alimentar_inbound(int) e bdr_enroll_email_pair (todas as
--    sobrecargas): só service_role. DO sobre pg_proc funciona com qualquer assinatura.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('consentimento_alimentar_inbound', 'bdr_enroll_email_pair')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 2. leadbroker_sdr_rotation: RLS por org (colunas: org_id, next_sdr, updated_at).
--    Leitura só para membros da própria org; escrita só via service_role.
DO $$
BEGIN
  IF to_regclass('public.leadbroker_sdr_rotation') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.leadbroker_sdr_rotation ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON public.leadbroker_sdr_rotation FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.leadbroker_sdr_rotation TO authenticated;
  GRANT ALL ON public.leadbroker_sdr_rotation TO service_role;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leadbroker_sdr_rotation' AND column_name = 'org_id'
  ) THEN
    DROP POLICY IF EXISTS leadbroker_sdr_rotation_select_own_org ON public.leadbroker_sdr_rotation;
    CREATE POLICY leadbroker_sdr_rotation_select_own_org
      ON public.leadbroker_sdr_rotation
      FOR SELECT TO authenticated
      USING (org_id = public.user_org_id());
  ELSE
    -- Sem coluna de org: nega anon/authenticated, só service_role (que ignora RLS).
    REVOKE ALL ON public.leadbroker_sdr_rotation FROM authenticated;
  END IF;
END $$;

COMMIT;

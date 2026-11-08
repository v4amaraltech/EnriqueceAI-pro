-- Correções de segurança MEDIUM restantes da auditoria (pistas 10, 13, 24, 27)
-- mais o índice único de calls (achado X2). Idempotente, forward-only.
--
-- Pistas 2 e 19 estão em 20261108130000. Pistas 3, 14 e 7 em 20261108120000.
-- Pistas 20, 21 e 22 em 20261108110000. Pistas 5, 8, 9, 11 e 15 são só de código.
--
-- Índice X2: ingest_callface_call usa ON CONFLICT ((metadata->>'callface_call_id'))
-- e em produção o índice existe (função aplicada via MCP), mas nenhuma migration o
-- cria. ATENÇÃO: se houver duplicatas de callface_call_id o CREATE falha. Conferir antes:
--   SELECT metadata->>'callface_call_id', count(*) FROM calls
--   WHERE metadata->>'callface_call_id' IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

BEGIN;

-- 0. Índice único parcial (X2) -----------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_callface_call_id
  ON public.calls ((metadata->>'callface_call_id'))
  WHERE metadata->>'callface_call_id' IS NOT NULL;

-- 1. Pista 10: segredos de apollo_connections e api4com_org_settings ---------------
-- SELECT em nível de tabela cobre todas as colunas, então o REVOKE de coluna sozinho
-- não adianta: troca-se o grant da tabela por grant das colunas não secretas.
-- Os leitores do segredo (getApolloApiKey, api4com.service) usam service_role.
-- crm_connections.credentials_encrypted fica para a fase 2 (SDRs ainda leem via
-- sessão em crm-sync/crm-push com select('*')).
DO $$
DECLARE
  t text;
  secret text;
  cols text;
BEGIN
  FOR t, secret IN
    SELECT * FROM (VALUES
      ('apollo_connections', 'api_key_encrypted'),
      ('api4com_org_settings', 'api_key_encrypted')
    ) AS v(t, secret)
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t AND column_name <> secret;

    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', cols, t);
  END LOOP;
END $$;

-- 2. Pista 13: interactions.lead_id precisa ser da mesma org --------------------------
-- Impede que um membro grave interação (e dispare triggers DEFINER) em lead de
-- outro tenant. Vale para todos os papéis: nenhum fluxo legítimo cruza orgs.
CREATE OR REPLACE FUNCTION public.guard_interaction_lead_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_lead_org uuid;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT l.org_id INTO v_lead_org FROM public.leads l WHERE l.id = NEW.lead_id;
  IF v_lead_org IS NOT NULL AND v_lead_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'interaction.lead_id pertence a outra organização'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_interaction_lead_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_interaction_lead_org ON public.interactions;
CREATE TRIGGER guard_interaction_lead_org
  BEFORE INSERT OR UPDATE OF lead_id, org_id ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_interaction_lead_org();

-- 3. Pista 24: contadores de cota ---------------------------------------------------
-- ai_usage: toda escrita real é service_role (RPC increment_ai_usage e
-- transcription.service). As policies de escrita do membro saem.
DROP POLICY IF EXISTS ai_usage_org_insert ON public.ai_usage;
DROP POLICY IF EXISTS ai_usage_org_update ON public.ai_usage;

-- whatsapp_credits: as server actions ainda incrementam com o cliente da sessão
-- (whatsapp-credit.service). Fase 1: mantém as policies, mas o trigger só aceita
-- aumento de used_credits/overage_count e proíbe mexer em plan_credits, org e período.
-- Fase 2: mover o débito para RPC SECURITY DEFINER só service_role e remover as policies.
CREATE OR REPLACE FUNCTION public.guard_whatsapp_credits_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_plan integer;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan_credits IS DISTINCT FROM OLD.plan_credits
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.period IS DISTINCT FROM OLD.period
       OR NEW.used_credits < OLD.used_credits
       OR NEW.overage_count < OLD.overage_count THEN
      RAISE EXCEPTION 'whatsapp_credits só pode ser incrementado pelo app'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT p.max_whatsapp_per_month INTO v_plan
    FROM public.subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
    WHERE s.org_id = NEW.org_id AND s.status = 'active'
    LIMIT 1;
    IF v_plan IS NULL
       OR NEW.plan_credits > v_plan
       OR NEW.used_credits < 1
       OR NEW.overage_count <> 0 THEN
      RAISE EXCEPTION 'linha de whatsapp_credits inválida para o plano da organização'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_whatsapp_credits_writes ON public.whatsapp_credits;
CREATE TRIGGER guard_whatsapp_credits_writes
  BEFORE INSERT OR UPDATE ON public.whatsapp_credits
  FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_credits_writes();

-- 4. Pista 27: modo own/team nas tabelas filhas -------------------------------------
-- O EXISTS em leads roda sob a RLS de leads do chamador, então herda a visibilidade.
-- Gerente e modo 'all' passam direto (sem custo extra). Fase 2: calls e
-- cadence_enrollments (fila e relatórios do SDR dependem delas hoje).
DROP POLICY IF EXISTS lead_contacts_org ON public.lead_contacts;
CREATE POLICY lead_contacts_org ON public.lead_contacts FOR ALL
  USING (
    org_id = (SELECT public.user_org_id())
    AND (
      (SELECT public.is_manager())
      OR (SELECT public.lead_visibility_mode()) = 'all'
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_contacts.lead_id)
    )
  )
  WITH CHECK (
    org_id = (SELECT public.user_org_id())
    AND public.lead_belongs_to_user_org(lead_id)
    AND (
      (SELECT public.is_manager())
      OR (SELECT public.lead_visibility_mode()) = 'all'
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_contacts.lead_id)
    )
  );

DROP POLICY IF EXISTS interactions_org_read ON public.interactions;
CREATE POLICY interactions_org_read ON public.interactions FOR SELECT
  USING (
    org_id = (SELECT public.user_org_id())
    AND (
      lead_id IS NULL
      OR (SELECT public.is_manager())
      OR (SELECT public.lead_visibility_mode()) = 'all'
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interactions.lead_id)
    )
  );

COMMIT;

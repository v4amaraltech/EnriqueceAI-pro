BEGIN;

-- =============================================================================
-- Pistas 20, 21 e 22 da auditoria (takeover de organizacao).
-- Aditiva e idempotente: so CREATE OR REPLACE de funcoes e triggers recriados.
--
-- 1) organizations.member_limit_override e stripe_customer_id so podem ser
--    gravados por service_role / funcoes SECURITY DEFINER (pista 22). A policy
--    org_owner_update deixava o dono (role authenticated) editar as duas.
-- 2) organization_members: um gerente (role authenticated) nao pode ativar
--    nem mover um usuario que nao seja ele mesmo (pistas 20 e 21). Convite
--    pendente ('invited') continua permitido; so o proprio usuario vira
--    'active' (acao acceptOrgInvite / acceptPendingInvite via service_role).
--
-- Os triggers valem apenas para os roles de cliente (authenticated, anon).
-- service_role e funcoes SECURITY DEFINER (current_user = dono) nao sao afetados.
-- As funcoes NAO sao SECURITY DEFINER de proposito: current_user precisa ser o
-- role da sessao.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_org_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.member_limit_override IS DISTINCT FROM OLD.member_limit_override
          OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id) THEN
    RAISE EXCEPTION 'member_limit_override e stripe_customer_id so podem ser alterados pelo backend'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_org_billing_columns ON public.organizations;
CREATE TRIGGER guard_org_billing_columns
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_org_billing_columns();

CREATE OR REPLACE FUNCTION public.guard_member_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'um membro so e ativado pelo proprio usuario (aceite do convite)'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'user_id e org_id de um membro nao podem ser alterados'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'active' AND OLD.status IN ('invited', 'removed')
       AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'um membro so e ativado pelo proprio usuario (aceite do convite)'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_member_consent ON public.organization_members;
CREATE TRIGGER guard_member_consent
  BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_consent();

COMMIT;

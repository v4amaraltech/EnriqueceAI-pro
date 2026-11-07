-- PR09 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 11):
-- politica de distribuicao de leads dentro do app.
--
-- Aditiva e forward-only: nao altera tabelas existentes, nao faz backfill, nao
-- reatribui leads e nao toca em numeros de envio. Nada aqui e lido ou escrito
-- enquanto as flags `lead_assignment_shadow` e `lead_assignment_enforced`
-- (app_flags, globais) estiverem desligadas; ambas nascem desligadas.
--
-- Modelo:
--   lead_assignment_policies  uma politica por organizacao: capacidade padrao e
--                             cursor de desempate (ultimo usuario sorteado) com
--                             `cursor_version` para controle otimista (CAS).
--   lead_assignment_members   elegiveis da politica, com capacidade propria
--                             opcional e posicao fixa no anel de desempate.
--
-- Escrita: somente service_role. `authenticated` apenas le, dentro da propria
-- organizacao (RLS com public.user_org_id()).

BEGIN;

-- 1. lead_assignment_policies --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_assignment_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  -- Maximo de carga aberta por elegivel; NULL = sem limite.
  default_capacity integer,
  -- Ultimo elegivel escolhido pelo desempate; o proximo empate vai para o
  -- seguinte no anel (position, user_id).
  cursor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cursor_version   integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_assignment_policies_capacity_chk
    CHECK (default_capacity IS NULL OR default_capacity >= 1),
  CONSTRAINT lead_assignment_policies_cursor_version_chk CHECK (cursor_version >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_assignment_policies_org
  ON public.lead_assignment_policies (org_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.lead_assignment_policies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_assignment_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.lead_assignment_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_assignment_policies_org_select ON public.lead_assignment_policies;
CREATE POLICY lead_assignment_policies_org_select ON public.lead_assignment_policies
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 2. lead_assignment_members ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_assignment_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  eligible   boolean NOT NULL DEFAULT true,
  -- Sobrescreve default_capacity; NULL = usa a padrao da politica.
  capacity   integer,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_assignment_members_capacity_chk CHECK (capacity IS NULL OR capacity >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_assignment_members_org_user
  ON public.lead_assignment_members (org_id, user_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.lead_assignment_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_assignment_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.lead_assignment_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_assignment_members_org_select ON public.lead_assignment_members;
CREATE POLICY lead_assignment_members_org_select ON public.lead_assignment_members
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- 3. Grants minimos --------------------------------------------------------------
REVOKE ALL ON public.lead_assignment_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lead_assignment_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_assignment_policies TO authenticated;
GRANT SELECT ON public.lead_assignment_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lead_assignment_policies TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.lead_assignment_members TO service_role;

-- 4. RPC assign_lead_by_policy ---------------------------------------------------
-- Atomica: trava a politica da organizacao (FOR UPDATE), confere o cursor
-- esperado (CAS) e so atribui lead SEM dono, sem pendencia e sem conversa em
-- andamento. Duas chamadas simultaneas para o mesmo lead ou para a mesma
-- organizacao serializam na trava: a segunda recebe 'cursor_conflict' ou
-- 'already_assigned', nunca duplica nem sobrescreve.
-- outcome: 'assigned' | 'already_assigned' | 'cursor_conflict' | 'no_policy'
--          | 'lead_not_in_org' | 'pending_assignment' | 'conversation_owner'
--          | 'not_eligible'
-- Nao toca em numeros, instancias, cadencias nem em outros leads.
CREATE OR REPLACE FUNCTION public.assign_lead_by_policy(
  p_org_id                uuid,
  p_lead_id               uuid,
  p_user_id               uuid,
  p_expected_cursor_version integer
)
RETURNS TABLE (outcome text, assigned_to uuid, cursor_version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_policy_id uuid;
  v_version   integer;
  v_current   uuid;
BEGIN
  SELECT p.id, p.cursor_version INTO v_policy_id, v_version
  FROM public.lead_assignment_policies p
  WHERE p.org_id = p_org_id AND p.enabled
  FOR UPDATE;

  IF v_policy_id IS NULL THEN
    RETURN QUERY SELECT 'no_policy'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  IF v_version <> p_expected_cursor_version THEN
    RETURN QUERY SELECT 'cursor_conflict'::text, NULL::uuid, v_version;
    RETURN;
  END IF;

  SELECT l.assigned_to INTO v_current
  FROM public.leads l
  WHERE l.id = p_lead_id AND l.org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lead_not_in_org'::text, NULL::uuid, v_version;
    RETURN;
  END IF;

  IF v_current IS NOT NULL THEN
    RETURN QUERY SELECT 'already_assigned'::text, v_current, v_version;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cadence_enrollments e
    WHERE e.org_id = p_org_id AND e.lead_id = p_lead_id
      AND e.pending_assigned_to IS NOT NULL
      AND e.status IN ('active', 'paused')
  ) THEN
    RETURN QUERY SELECT 'pending_assignment'::text, NULL::uuid, v_version;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversation_ownership o
    WHERE o.org_id = p_org_id AND o.lead_id = p_lead_id
      AND o.status = 'active' AND o.owner_user_id IS NOT NULL
  ) THEN
    RETURN QUERY SELECT 'conversation_owner'::text, NULL::uuid, v_version;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lead_assignment_members m
    JOIN public.organization_members om
      ON om.org_id = m.org_id AND om.user_id = m.user_id AND om.status = 'active'
    WHERE m.org_id = p_org_id AND m.user_id = p_user_id AND m.eligible
  ) THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::uuid, v_version;
    RETURN;
  END IF;

  UPDATE public.leads SET assigned_to = p_user_id
  WHERE id = p_lead_id AND org_id = p_org_id AND assigned_to IS NULL;

  UPDATE public.lead_assignment_policies
  SET cursor_user_id = p_user_id, cursor_version = v_version + 1
  WHERE id = v_policy_id;

  RETURN QUERY SELECT 'assigned'::text, p_user_id, v_version + 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_lead_by_policy(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead_by_policy(uuid, uuid, uuid, integer) TO service_role;

-- 5. Flags (desligadas) --------------------------------------------------------
-- Escopo global, como as demais flags de app_flags.
INSERT INTO public.app_flags (key, enabled, note)
VALUES
  ('lead_assignment_shadow', false, 'PR09: calcula a distribuicao pela politica e registra a comparacao com a atribuicao atual, sem alterar nada'),
  ('lead_assignment_enforced', false, 'PR09: permite ao servico gravar a atribuicao pela politica (nenhum chamador integrado neste PR)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

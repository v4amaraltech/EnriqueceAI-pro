BEGIN;

-- Motor automático do Cockpit: 3 flags, todas DESLIGADAS e sem nenhuma organização ou
-- usuário liberado (allow_org_ids e allow_user_ids vazios). Esta migration só cria as linhas
-- (dados, nenhuma tabela muda). Não marcar enabled = true em nenhuma delas: ligaria todas as orgs.
--
-- Dependências (CON-6):
--   * o motor (simulado) só aparece com `call_cockpit_outcomes` E `cockpit_auto_dial` ligadas
--     para o usuário;
--   * a ligação REAL exige as 3 (`call_cockpit_outcomes`, `cockpit_auto_dial` e
--     `cockpit_auto_dial_live`) e o clique de Iniciar. Sem a `_live`, o motor roda simulado.
--
-- Para ligar: acrescentar o uuid da organização em allow_org_ids e, para estreitar a um
-- piloto, o uuid do usuário em allow_user_ids.
-- Rollback: tirar o usuário/organização das listas (ou esvaziar as listas). Nenhum deploy é
-- necessário; flag desligada = Cockpit como antes.
--
-- `call_cockpit_outcomes` (painel de resultado do cartão) não existia em app_flags; o código a
-- lia como desligada. ON CONFLICT DO NOTHING preserva qualquer linha que já exista.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES
  (
    'call_cockpit_outcomes',
    false,
    'Painel de resultado da ligação no cartão do Cockpit. Pré-requisito do motor automático. Desligada: Cockpit como antes. Para ligar, acrescente o uuid em allow_org_ids (e, no piloto, em allow_user_ids). Não marque enabled = true (ligaria todas as orgs).',
    '{}'::uuid[],
    '{}'::uuid[]
  ),
  (
    'cockpit_auto_dial',
    false,
    'Motor automático do Cockpit em modo SIMULADO (não liga de verdade). Exige call_cockpit_outcomes ligada. Para ligar, acrescente o uuid em allow_org_ids e, no piloto, em allow_user_ids. Não marque enabled = true (ligaria todas as orgs).',
    '{}'::uuid[],
    '{}'::uuid[]
  ),
  (
    'cockpit_auto_dial_live',
    false,
    'Libera a LIGAÇÃO REAL no motor automático do Cockpit. Exige call_cockpit_outcomes e cockpit_auto_dial ligadas. Só com aprovação explícita. Sem esta flag o motor roda simulado. Não marque enabled = true (ligaria todas as orgs).',
    '{}'::uuid[],
    '{}'::uuid[]
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;

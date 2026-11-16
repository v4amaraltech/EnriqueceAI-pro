BEGIN;

-- Flag própria da ordem do lead frio no Cockpit (DP-8). Nasce desligada e SEM nenhuma
-- organização liberada (allow_org_ids vazio): ninguém liga até alguém acrescentar o uuid
-- da V4 (c2727473-1df8-4faa-9264-a9fc1759fe3b) em allow_org_ids. Não marcar enabled = true
-- (ligaria todas as orgs). Rollback = esvaziar allow_org_ids. Independe de `call_priority_v2`.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'cockpit_cold_order',
  false,
  'Ordem do lead frio no cartão Próxima ligação do Cockpit (cadência vencida > futura > sem cadência; teto 2/dia; mais de 6 em 30d desce). Desligada: Cockpit como antes. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas).',
  '{}'::uuid[],
  '{}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

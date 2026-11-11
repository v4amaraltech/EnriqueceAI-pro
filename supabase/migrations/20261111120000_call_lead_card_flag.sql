BEGIN;

-- Cartão estruturado do lead no meio do painel de ligação, e a opção de abrir
-- o mesmo painel em Atividades. Nasce desligada. A única org liberada é a
-- V4 Company Amaral. Não marca enabled = true (isso ligaria todas as orgs).
-- Não aplica sozinha em produção: é só a linha da flag.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'call_lead_card_v1',
  false,
  'Cartão do lead no meio do painel de ligação e opção de abrir o mesmo painel em Atividades. Desligada: o meio do painel e a fila seguem como hoje. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas).',
  ARRAY['c2727473-1df8-4faa-9264-a9fc1759fe3b']::uuid[],
  '{}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

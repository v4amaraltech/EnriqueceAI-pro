BEGIN;

-- PR06: flags do gateway de decisao de envio. Nascem DESLIGADAS; escopo global,
-- como as demais flags de app_flags. Migration aditiva: so insere duas linhas.
-- Nenhum caminho de envio real consome estas flags neste PR.
INSERT INTO public.app_flags (key, enabled, note)
VALUES
  ('send_gateway_shadow', false, 'PR06: gateway compara a decisao com o fluxo atual e registra, sem enviar nem alterar o fluxo'),
  ('send_gateway_enforced', false, 'PR06: gateway obrigatorio antes de qualquer envio (ainda nao integrado a nenhum caminho)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

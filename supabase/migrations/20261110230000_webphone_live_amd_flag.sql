BEGIN;

-- Piloto de escuta ao vivo no webphone. A flag nasce com enabled = false,
-- então só vale para as orgs de allow_org_ids. V4 Company Amaral é a única.
-- enabled = true ligaria todas as organizações. Não aplicar à mão em produção:
-- o deploy é quem roda a migration. Nesta fase o navegador só registra se a
-- faixa remota chegou. Nenhum áudio sai do browser.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'webphone_live_amd',
  false,
  'Escuta ao vivo da faixa remota do webphone, só para orgs em allow_org_ids. Piloto: V4 Company Amaral. enabled = true ligaria todas. Nesta fase o navegador só registra a chegada do áudio.',
  ARRAY['c2727473-1df8-4faa-9264-a9fc1759fe3b']::uuid[],
  '{}'::uuid[]
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

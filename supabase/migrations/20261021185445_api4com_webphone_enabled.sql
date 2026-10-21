-- Story api4com-embedded-webphone (bloco 2): liberação do webphone no
-- navegador por SDR. Fica desligado por padrão; o gestor liga pessoa a pessoa
-- na tela de integrações (validação: um SDR por um dia inteiro antes do time).
-- Com o webphone ligado, a página registra o ramal por WebRTC e a extensão do
-- Chrome da pessoa precisa ficar fechada (os dois disputam o mesmo ramal).
BEGIN;

ALTER TABLE api4com_connections
  ADD COLUMN IF NOT EXISTS webphone_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;

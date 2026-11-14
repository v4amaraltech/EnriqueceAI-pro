-- Impede gravar a mesma resposta de e-mail duas vezes (id da mensagem no Gmail).
-- Parcial: só type=replied com external_id preenchido. Não se aplica a sent/opened/clicked.
-- Aplicar em produção somente com aprovação, antes do merge.

CREATE UNIQUE INDEX IF NOT EXISTS interactions_replied_external_id_uidx
  ON public.interactions (org_id, external_id)
  WHERE type = 'replied' AND external_id IS NOT NULL;

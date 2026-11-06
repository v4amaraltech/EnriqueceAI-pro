-- Feedback do closer: "Ganho" marcado antes do início da reunião não pode
-- descartar o pedido (caso NEXT360 Telecom, 30/10/2026 — closer nunca recebeu
-- o link e o card do Kommo nunca nasceu).
--
-- `sent_at` passa a significar o momento do ENVIO REAL do link:
--   NULL  → pedido criado, aguardando a reunião começar (ou tentativa falhou);
--           o cron feedback-reminders envia quando leads.meeting_starts_at passa.
--   valor → link saiu por e-mail e/ou WhatsApp; a partir daqui contam os 7 dias
--           de validade e os lembretes.
--
-- Parte 1 de 2 (aplicada em prod em 06/11/2026, versão 20261106193118).
-- O DEFAULT now() fica até o deploy do código novo: o código antigo insere sem
-- sent_at e envia o link na hora — sem o default essas linhas nasceriam NULL e
-- o cron novo reenviaria o link. A parte 2 (drop default) roda após o deploy.
-- Story: closer-feedback-deferred-until-meeting.
BEGIN;

ALTER TABLE public.closer_feedback_requests
  ALTER COLUMN sent_at DROP NOT NULL;

COMMENT ON COLUMN public.closer_feedback_requests.sent_at IS
  'Momento do envio real do link ao closer. NULL = agendado (reunião ainda não começou) ou envio pendente de retry pelo cron feedback-reminders.';

-- Fila do cron: linhas ainda não enviadas e não respondidas.
CREATE INDEX IF NOT EXISTS idx_closer_feedback_unsent
  ON public.closer_feedback_requests (expires_at)
  WHERE sent_at IS NULL AND responded_at IS NULL;

COMMIT;

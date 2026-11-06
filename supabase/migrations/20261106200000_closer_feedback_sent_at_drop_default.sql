-- Feedback do closer — parte 2 de 2 de closer_feedback_sent_at_nullable.
--
-- APLICAR EM PROD SÓ DEPOIS DO DEPLOY do PR #509 (o código novo sempre grava
-- sent_at explicitamente: NULL quando agendado, now() quando envia na hora).
-- Sem DEFAULT: qualquer linha inserida sem sent_at é "ainda não enviada", e o
-- cron feedback-reminders cuida dela. Story: closer-feedback-deferred-until-meeting.
BEGIN;

ALTER TABLE public.closer_feedback_requests
  ALTER COLUMN sent_at DROP DEFAULT;

COMMIT;

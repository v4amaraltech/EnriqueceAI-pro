BEGIN;

-- Atualização automática do CRM, log sombra do hangup determinístico (rules_version 'hangup_v1').
--
-- NÃO aplicar em produção neste PR. Aplicar junto com o deploy, depois do PR aprovado.
-- Ordem: esta migration PRIMEIRO, depois o código. Se o código subir antes, o INSERT com
-- qualification_id nulo falha e o log não entra; o webhook de hangup em si não é afetado
-- (o wrapper engole o erro).
--
-- Aditiva e mínima: qualification_id passa a aceitar nulo, só para as propostas que vêm da
-- causa do hangup (sem qualificação JEV). A FK continua (ON DELETE CASCADE com nulo é válido).
-- Não recria views, não mexe em app_flags, não faz UPDATE nem DELETE no log (append-only),
-- sem backfill. Não altera calls, leads, scheduled_activities, interactions,
-- call_transcripts_v2 nem call_qualifications.

ALTER TABLE public.crm_auto_update_shadow_log
  ALTER COLUMN qualification_id DROP NOT NULL;

COMMENT ON COLUMN public.crm_auto_update_shadow_log.qualification_id IS
  'Qualificação JEV que originou a proposta. Nulo quando a proposta veio do hangup determinístico '
  '(rules_version = ''hangup_v1''), sem qualificação JEV.';

COMMIT;

-- Ganhos rápidos no banco (auditoria de 04/10/2026).
--
-- 1. Índices de expressão em calls.metadata.
--    `calls` (~52k linhas) somava ~1,9 mi de varreduras completas: toda busca de
--    ligação pelo id da API4COM (`.eq('metadata->>api4com_call_id', …)` no webhook
--    api4com, na conferência horária reconcile-api4com-calls e no worker
--    back-associate-api4com-webhooks, a cada 30 min) lia a tabela inteira —
--    ~1,5 mi de execuções, ~18.600 s de banco no total. Só existia índice para
--    callface_call_id.
--    Parcial com `IS NOT NULL` (mesmo padrão de uq_calls_callface_call_id): o
--    planner prova `x = valor ⇒ x IS NOT NULL` e usa o índice. Não é UNIQUE —
--    há 6 api4com_call_id repetidos em prod.
--    service_call_id (webhook wacalls, ~300 linhas) entra junto: custo ~zero.
--    (A auditoria apontou service_call_id; pg_stat_statements normaliza a chave
--    para $1 — a contagem de linhas e o código mostraram que era api4com_call_id.)
--
-- 2. Limpeza diária de cron.job_run_details.
--    O pg_cron guarda uma linha por execução e nunca limpa: ~316k linhas desde
--    27/03, ~300 MB — a maior tabela do banco. Retenção de 14 dias (decisão do
--    Vini, 04/10). Roda 03:15 BRT (06:15 UTC), fora do horário comercial.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_calls_api4com_call_id
  ON public.calls ((metadata ->> 'api4com_call_id'))
  WHERE (metadata ->> 'api4com_call_id') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_service_call_id
  ON public.calls ((metadata ->> 'service_call_id'))
  WHERE (metadata ->> 'service_call_id') IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-cron-job-run-details') THEN
    PERFORM cron.unschedule('cleanup-cron-job-run-details');
  END IF;
  PERFORM cron.schedule(
    'cleanup-cron-job-run-details',
    '15 6 * * *',
    $cron$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '14 days'$cron$
  );
END $$;

COMMIT;

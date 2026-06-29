-- H3 (Auditoria cadência de e-mail, 29/jun): impedir double-send de passo de
-- cadência. O motor (execute-cadence.ts) tinha idempotência check-then-act sem
-- trava: dois runs concorrentes (cron + executePendingSteps manual, ou execuções
-- sobrepostas) podiam ambos inserir a interação 'sent' e ambos enviar o e-mail.
--
-- Diagnóstico em prod (cadência "Prospect - Educação" e outras): 36 grupos
-- (cadence_id, step_id, lead_id) com >1 'sent'. Destes, apenas 2 eram double-send
-- REAL (>=2 com external_id/messageId do Gmail); 69 linhas eram 'sent' FANTASMA
-- (sem external_id) — o sintoma do bug C1 (insert otimista 'sent' antes do envio,
-- nunca confirmado). Esses fantasmas inflavam "Enviados".
--
-- Estratégia NÃO-destrutiva: em vez de DELETAR as duplicatas, reclassificamos as
-- excedentes como 'failed' (preservando tudo em metadata, inclusive se havia
-- external_id). Mantemos 1 'sent' por grupo — preferindo a que tem external_id
-- (envio real comprovado); na ausência, a mais antiga. Depois criamos o índice
-- único parcial que impede futuras duplicatas. O código passa a tratar 23505 como
-- idempotente (avança em vez de reenviar).

BEGIN;

-- 1) Backfill: reclassifica as 'sent' excedentes de cada grupo como 'failed'.
--    rn=1 (a manter) prioriza linha COM external_id, depois a mais antiga.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY cadence_id, step_id, lead_id
           ORDER BY (external_id IS NOT NULL) DESC, created_at ASC
         ) AS rn
  FROM interactions
  WHERE type = 'sent' AND step_id IS NOT NULL
)
UPDATE interactions i
SET type = 'failed',
    metadata = COALESCE(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'error', 'duplicate_send_reconciled',
      'backfill', 'h3_dedup_20260629',
      'was_type', 'sent',
      'had_external_id', (i.external_id IS NOT NULL)
    )
FROM ranked r
WHERE i.id = r.id AND r.rn > 1;

-- 2) Índice único parcial: no máximo 1 'sent' por (cadência, passo, lead).
--    Restringe a step_id IS NOT NULL para não afetar interações de sistema
--    (reativação, etc.) que usam step_id NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interactions_sent_step_lead
  ON interactions (cadence_id, step_id, lead_id)
  WHERE type = 'sent' AND step_id IS NOT NULL;

COMMIT;

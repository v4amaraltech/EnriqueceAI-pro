-- Motivo de perda canônico no lead.
--
-- Até aqui o motivo de perda vivia em cadence_enrollments.loss_reason_id, mas
-- markLeadLost só grava em enrollment active/paused — leads perdidos sem
-- cadência ativa (a maioria) nunca recebiam o motivo lá (V4 Amaral jun: 157
-- perdas, 0 na coluna). O motivo é conceitualmente do LEAD, não da cadência.
--
-- Adiciona leads.loss_reason_id (+ loss_notes) como fonte canônica, e faz
-- backfill a partir da última interação lead_lost de cada lead (registro
-- autoritativo, ~1072 leads). loss_notes recebe o marcador "Auto-perda por
-- inatividade" quando a perda foi automática (cron), para a leitura conseguir
-- excluí-la — mesma semântica de exclusão de antes.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS loss_reason_id uuid REFERENCES loss_reasons(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS loss_notes text;

WITH latest AS (
  SELECT DISTINCT ON (i.lead_id)
    i.lead_id,
    (i.metadata->>'loss_reason_id')::uuid AS loss_reason_id,
    (i.metadata->>'reason')               AS reason
  FROM interactions i
  WHERE i.metadata->>'system_event' = 'lead_lost'
    AND i.metadata->>'loss_reason_id' IS NOT NULL
  ORDER BY i.lead_id, i.created_at DESC
)
UPDATE leads l
SET loss_reason_id = latest.loss_reason_id,
    loss_notes = CASE WHEN latest.reason = 'auto_loss_inactivity'
                      THEN 'Auto-perda por inatividade'
                      ELSE l.loss_notes END
FROM latest
WHERE l.id = latest.lead_id
  AND l.loss_reason_id IS NULL;

COMMIT;

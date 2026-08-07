-- Backfill: linkar interações de ligação externa à sua linha em `calls`.
--
-- Ligações externas (API4COM, criadas via webhook em createCallFromWebhook +
-- createExternalCallInteraction) gravavam a interação SEM metadata.callId.
-- A timeline do lead (fetchLeadTimeline) só enriquece gravação/transcrição
-- quando a interação tem metadata.callId → o player de áudio nunca aparecia
-- para essas ligações (Enriquece AI: 1.284 de 1.287 interações externas).
--
-- O webhook já passou a gravar o callId daqui pra frente. Esta migration
-- corrige o histórico casando pelo id do API4COM (api4com_id da interação ↔
-- api4com_call_id / alt_api4com_ids da call). DISTINCT ON resolve os poucos
-- casos (3) em que o mesmo id casa com mais de uma call, preferindo a que
-- tem gravação e a mais recente.
--
-- Idempotente: só toca interações com callId ainda nulo.

BEGIN;

WITH matched AS (
  SELECT DISTINCT ON (i.id)
    i.id AS interaction_id,
    c.id AS call_id
  FROM interactions i
  JOIN calls c
    ON c.org_id = i.org_id
   AND (
        c.metadata->>'api4com_call_id' = i.metadata->>'api4com_id'
        OR c.metadata->'alt_api4com_ids' ? (i.metadata->>'api4com_id')
       )
  WHERE i.channel = 'phone'
    AND i.metadata->>'source' = 'external_api4com'
    AND (i.metadata->>'callId') IS NULL
    AND (i.metadata->>'api4com_id') IS NOT NULL
  ORDER BY i.id, (c.recording_url IS NOT NULL) DESC, c.created_at DESC
)
UPDATE interactions i
SET metadata = i.metadata || jsonb_build_object('callId', m.call_id::text)
FROM matched m
WHERE i.id = m.interaction_id;

COMMIT;

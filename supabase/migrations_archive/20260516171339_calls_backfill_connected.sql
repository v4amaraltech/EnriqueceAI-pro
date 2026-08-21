-- Backfill de calls.connected, calls.hangup_cause e calls.answered_at para o
-- histórico de Abr/Mai 2026.
--
-- Estratégia (ordem de precedência, da mais confiável pra menos):
--
--   1. metadata->>hangup_cause = 'NORMAL_CLEARING' + duration>0 → connected=true
--      (reconcile já vinha persistindo hangup_cause em metadata desde 2026-05-13;
--       webhook NÃO persistia — só está disponível pra calls que passaram pelo
--       reconcile)
--
--   2. status IN ('significant','not_significant') → connected=true
--      (já refletia uma chamada onde houve áudio)
--
--   3. Manual calls (type='manual') com duration>0 e status fora dos
--      explicitamente não-conectados → connected=true
--      (classify-webphone-call só atribui status quando SDR classifica
--       manualmente; tipicamente são calls atendidas curtas)
--
--   4. Caso contrário → connected=false (default).
--
-- Esta migration é IDEMPOTENTE: o filtro WHERE connected=false impede que uma
-- segunda execução desfaça atualizações já feitas.

BEGIN;

UPDATE calls
SET
  hangup_cause = COALESCE(hangup_cause, NULLIF(metadata->>'hangup_cause', '')),
  answered_at = COALESCE(
    answered_at,
    NULLIF(metadata->>'answered_at', '')::timestamptz
  ),
  connected = CASE
    -- Regra 1: hangup_cause persistido (mais confiável)
    WHEN COALESCE(metadata->>'hangup_cause', '') = 'NORMAL_CLEARING'
         AND duration_seconds > 0
      THEN true
    -- Regra 2: status já indicava call com áudio
    WHEN status IN ('significant', 'not_significant')
      THEN true
    -- Regra 3: classificação manual via webphone
    WHEN type = 'manual'
         AND duration_seconds > 0
         AND status NOT IN ('no_contact', 'not_connected', 'busy')
      THEN true
    ELSE false
  END
WHERE started_at >= '2026-04-01'::timestamptz
  AND started_at <  '2026-06-01'::timestamptz
  AND connected = false; -- idempotência: não regredir valores já corrigidos

COMMIT;

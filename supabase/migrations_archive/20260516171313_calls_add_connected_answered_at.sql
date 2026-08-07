-- Adiciona colunas que faltavam para refletir corretamente o estado da chamada:
--
--   connected     = true quando a chamada foi atendida (answered_at != NULL via
--                   webhook OU hangup_cause='NORMAL_CLEARING'+duration>0 via REST)
--   answered_at   = timestamp do channel-answer (preenchido pelo webhook)
--   hangup_cause  = FreeSWITCH cause (NORMAL_CLEARING, NO_ANSWER, USER_BUSY, ...)
--
-- Motivação:
--   Até 16/05/2026 a tabela só tinha `status` (significant/not_significant/
--   no_contact/busy/not_connected). O webhook e o reconcile colocavam tudo que
--   tinha duration < 50s em 'no_contact' — incluindo chamadas REAL ATENDIDAS de
--   5-49s. O Sales Hub, que consome via n8n `connected=(status='significant')`,
--   subreportava chamadas atendidas em −79% (205 medidos vs 970 reais em mai/26).
--
--   `connected` vira a SOURCE OF TRUTH pro Sales Hub e para qualquer outro
--   downstream que pergunta "essa call foi atendida?". `status` continua sendo o
--   eixo de qualidade da call (significativa vs curta vs não-conectada).

BEGIN;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS hangup_cause TEXT NULL;

COMMENT ON COLUMN calls.connected IS
  'True quando a chamada foi atendida. Source of truth para Sales Hub e dashboards externos. Preenchido pelo webhook (answered_at != NULL) ou pelo reconcile (hangup_cause=NORMAL_CLEARING AND duration>0).';
COMMENT ON COLUMN calls.answered_at IS
  'Timestamp do channel-answer da API4COM (preenchido pelo webhook). NULL para calls não atendidas ou ingeridas via REST/reconcile.';
COMMENT ON COLUMN calls.hangup_cause IS
  'FreeSWITCH hangup cause da API4COM (NORMAL_CLEARING, NO_ANSWER, USER_BUSY, CALL_REJECTED, etc.). Preenchido pelo webhook (channel-hangup) e reconcile.';

-- Query mais comum do SH/dashboard: "calls atendidas da org no período X".
-- Index parcial só nas atendidas porque é a query quente.
CREATE INDEX IF NOT EXISTS idx_calls_org_connected_started
  ON calls(org_id, started_at DESC)
  WHERE connected = true;

-- Index para análises de "por que não conectou" (no_contact/busy/etc).
CREATE INDEX IF NOT EXISTS idx_calls_hangup_cause
  ON calls(org_id, hangup_cause)
  WHERE hangup_cause IS NOT NULL;

COMMIT;

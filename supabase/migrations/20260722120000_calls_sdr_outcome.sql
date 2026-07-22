-- Desfecho da ligação informado pelo SDR, SEPARADO do status técnico.
--
-- POR QUE UMA COLUNA NOVA (e não reaproveitar `calls.status`):
-- `calls.status` é a MEDIÇÃO OBJETIVA da telefonia — o webhook do API4COM o
-- classifica a partir de hangup_cause + duração, e no WhatsApp ele vem do sinal
-- de atendimento. Em maio/2026 o input manual do SDR sobrescrevia esse campo e
-- gerou divergência que o time de BI reclamou (ver o comentário no topo de
-- src/features/calls/actions/classify-webphone-call.ts). A correção na época foi
-- parar de aplicar o input do SDR.
--
-- Só que o SDR sabe algo que a telefonia NÃO sabe: o que aconteceu na conversa
-- (relevante? gatekeeper? sem interesse?). Esse dado estava sendo perdido.
-- Então: `status` continua técnico/automático e `sdr_outcome` guarda a leitura
-- do SDR. Os dois convivem, ninguém sobrescreve ninguém.
--
-- Reusa o enum `call_status` existente (20260221001500_calls_module.sql) — sem
-- valores novos, para não quebrar o BI do Sales Hub, que consome `status`.

BEGIN;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS sdr_outcome call_status;

COMMENT ON COLUMN calls.sdr_outcome IS
  'Desfecho informado pelo SDR ao concluir a ligação. NÃO confundir com calls.status (medição objetiva da telefonia). Nullable: ligações antigas e as concluídas sem seleção ficam NULL.';

-- Consultas de BI filtram por org + desfecho; o índice parcial evita indexar as
-- ligações antigas (todas NULL).
CREATE INDEX IF NOT EXISTS idx_calls_sdr_outcome
  ON calls (org_id, sdr_outcome)
  WHERE sdr_outcome IS NOT NULL;

COMMIT;

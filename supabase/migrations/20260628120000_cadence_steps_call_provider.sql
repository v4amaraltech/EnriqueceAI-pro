-- Story 7.2 (Epic 7 — Ligação via WhatsApp): discriminador de provider no passo
-- de ligação. A decisão de arquitetura é REUSAR channel='phone' (a ligação
-- WhatsApp conta como Ligação nas métricas/BI) e distinguir o discador via esta
-- coluna, evitando um novo valor no enum channel_type.
--
--   call_provider = NULL       -> ligação PSTN/API4COM (discador atual)
--   call_provider = 'whatsapp' -> discador WhatsApp-nativo (WebRTC)
--
-- Ref: docs/plans/whatsapp-call-activity-plan.md (§B.1), docs/stories/7.2

BEGIN;

ALTER TABLE cadence_steps
  ADD COLUMN IF NOT EXISTS call_provider TEXT;

COMMENT ON COLUMN cadence_steps.call_provider IS
  'Discriminador do passo de ligação (channel=phone): NULL = PSTN/API4COM, ''whatsapp'' = discador WhatsApp-nativo. Ver epic-7.';

-- CHECK idempotente: só valores conhecidos (extensível no futuro).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cadence_steps_call_provider'
  ) THEN
    ALTER TABLE cadence_steps
      ADD CONSTRAINT chk_cadence_steps_call_provider
      CHECK (call_provider IS NULL OR call_provider IN ('whatsapp'));
  END IF;
END $$;

COMMIT;

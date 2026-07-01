-- Canais do "Agendar retorno": além de Ligação/WhatsApp/Email, o SDR pode agendar
-- um retorno via "Ligação por WhatsApp" (Epic 7). Espelha cadence_steps.call_provider:
-- reusa channel='phone' e discrimina o discador por esta coluna, sem novo valor no
-- enum channel_type.
--
--   call_provider = NULL       -> retorno de ligação PSTN/API4COM (discador atual)
--   call_provider = 'whatsapp' -> retorno de ligação via discador WhatsApp-nativo (WebRTC)
--
-- Ref: 20260628120000_cadence_steps_call_provider.sql

BEGIN;

ALTER TABLE scheduled_activities
  ADD COLUMN IF NOT EXISTS call_provider TEXT;

COMMENT ON COLUMN scheduled_activities.call_provider IS
  'Discriminador do retorno de ligação (channel=phone): NULL = PSTN/API4COM, ''whatsapp'' = discador WhatsApp-nativo. Ver epic-7.';

-- CHECK idempotente: só valores conhecidos (extensível no futuro).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_scheduled_activities_call_provider'
  ) THEN
    ALTER TABLE scheduled_activities
      ADD CONSTRAINT chk_scheduled_activities_call_provider
      CHECK (call_provider IS NULL OR call_provider IN ('whatsapp'));
  END IF;
END $$;

COMMIT;

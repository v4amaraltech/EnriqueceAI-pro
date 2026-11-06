-- Tipo da atividade agendada.
--
-- A tarefa automática "Definir destino" (cron cadence-limbo-alert →
-- createPausedCadenceFollowups) é gravada em scheduled_activities com
-- channel='research' por falta de canal próprio. Na fila ela aparecia como
-- "Pesquisa", misturada aos retornos agendados pelo SDR. `kind` separa as duas:
--   'return'         → retorno agendado pelo SDR (padrão)
--   'limbo_followup' → tarefa "Definir destino" criada pelo robô
BEGIN;

ALTER TABLE public.scheduled_activities
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'return';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_activities_kind_check'
      AND conrelid = 'public.scheduled_activities'::regclass
  ) THEN
    ALTER TABLE public.scheduled_activities
      ADD CONSTRAINT scheduled_activities_kind_check
      CHECK (kind IN ('return', 'limbo_followup'));
  END IF;
END $$;

-- Passivo: toda tarefa do robô começa com "Definir destino:" (buildFollowupNote).
UPDATE public.scheduled_activities
SET kind = 'limbo_followup'
WHERE kind = 'return'
  AND notes LIKE 'Definir destino:%';

COMMIT;

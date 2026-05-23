-- Goal column for the new "Reuniões Marcadas" KPI card (chart cumulativo).
-- Pareia com meetings_held_target adicionado na migration anterior do dia.
BEGIN;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS meetings_scheduled_target integer NOT NULL DEFAULT 0;
COMMIT;

-- Goal column for the new "Reuniões Realizadas" card (grid 2 do dashboard).
-- The card pairs with two derived metrics that don't need their own target:
-- "Reuniões Marcadas" (leads.meeting_scheduled_at em maio) and the
-- "Hit Rate" (realizadas / leads abertos).
BEGIN;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS meetings_held_target integer NOT NULL DEFAULT 0;
COMMIT;

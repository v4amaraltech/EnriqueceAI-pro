-- Metas individuais de reuniões por SDR (marcadas/realizadas).
-- Alimentam o "ideal dia" POR VENDEDOR nos cards "Reuniões Marcadas" e
-- "Reuniões Realizadas" do dashboard. Antes só existia meta org-level em
-- `goals.meetings_scheduled_target`/`meetings_held_target`, dividida igualmente
-- entre os SDRs — o que dava o mesmo ideal pra todos. Com meta individual, cada
-- SDR (ex.: quem tem meta maior) tem seu próprio ideal paceado por dia útil.
-- Pareia com as colunas org-level adicionadas em 20260522232341/20260522233331.
BEGIN;
ALTER TABLE public.goals_per_user
  ADD COLUMN IF NOT EXISTS meetings_scheduled_target integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meetings_held_target integer NOT NULL DEFAULT 0;
COMMIT;

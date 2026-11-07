-- Cockpit do SDR (story sdr-cockpit), aba Closers: o gestor liga/desliga quem
-- aparece no modal de agendar reunião. Padrão: todos habilitados (nada muda
-- para quem já agenda hoje).

BEGIN;

ALTER TABLE public.closers
  ADD COLUMN IF NOT EXISTS scheduling_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.closers.scheduling_enabled IS
  'Se o closer aparece para agendamento de reunião. Só gestor altera (Cockpit > Closers).';

COMMIT;

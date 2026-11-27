-- Retorno guarda o contato indicado (story cockpit-retorno-contato-indicado, entrega B1).
-- Coluna opcional: retornos sem contato (a maioria) seguem como hoje.
-- Aplicar ANTES do deploy do código que grava contact_id.
-- A FK não garante que o contato é do mesmo lead/org: quem LER deve filtrar por lead_id e org_id.

BEGIN;

-- Se a trava não sair em 5 s, aborta (é só repetir) em vez de segurar a fila atrás dela.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.scheduled_activities
  ADD COLUMN IF NOT EXISTS contact_id uuid
  REFERENCES public.lead_contacts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_activities_contact_id
  ON public.scheduled_activities (contact_id)
  WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN public.scheduled_activities.contact_id IS
  'Contato (lead_contacts) para quem ligar neste retorno, quando houver ("Indicou outra pessoa").';

COMMIT;

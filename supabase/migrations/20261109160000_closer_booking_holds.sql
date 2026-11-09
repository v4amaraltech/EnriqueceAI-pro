-- Trava de marcação do closer no cockpit.
-- closer_id aqui é closers.id. Não reutiliza calendar_slots: lá o closer_id é o
-- usuário dono da agenda no fluxo BDR, e misturar os dois quebraria o EXCLUDE
-- daquele caminho (hoje sem uso em produção, mas o schema continua valendo).
-- A exclusão só vale para status = 'held'. Liberar ou cancelar não apaga a linha.
-- Sem cron. Esta migration não é aplicada por este PR.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.closer_booking_holds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  closer_id          uuid NOT NULL REFERENCES public.closers(id) ON DELETE CASCADE,
  lead_id            uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  slot_start         timestamptz NOT NULL,
  slot_end           timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'cancelled')),
  calendar_event_id  text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  released_at        timestamptz,
  CHECK (slot_end > slot_start)
);

CREATE INDEX IF NOT EXISTS idx_closer_booking_holds_closer_held
  ON public.closer_booking_holds (closer_id, slot_start)
  WHERE status = 'held';

CREATE INDEX IF NOT EXISTS idx_closer_booking_holds_lead_held
  ON public.closer_booking_holds (lead_id)
  WHERE status = 'held';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'closer_booking_holds_sem_sobreposicao'
  ) THEN
    ALTER TABLE public.closer_booking_holds
      ADD CONSTRAINT closer_booking_holds_sem_sobreposicao
      EXCLUDE USING gist (
        closer_id WITH =,
        tstzrange(slot_start, slot_end, '[)') WITH &&
      ) WHERE (status = 'held');
  END IF;
END $$;

ALTER TABLE public.closer_booking_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closer_booking_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.closer_booking_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.closer_booking_holds TO service_role;
DROP POLICY IF EXISTS closer_booking_holds_org ON public.closer_booking_holds;
CREATE POLICY closer_booking_holds_org ON public.closer_booking_holds
  FOR ALL
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

COMMENT ON TABLE public.closer_booking_holds IS
  'Reserva do closer (closers.id) no agendamento do cockpit. EXCLUDE impede duas reuniões held no mesmo intervalo. Não é a calendar_slots do BDR.';

COMMIT;

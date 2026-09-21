-- BDR-4 — Agenda sem conflito (plano docs/bdr/plano-bdr-ia.md do V4 Call, §7.3)
-- Por quê: freeBusy → insert não garante exclusividade (consulta e criação são
-- operações separadas). Aqui: solicitação de reunião compartilhada pelos canais
-- (uma ativa por lead), reserva atômica por closer e intervalo (EXCLUDE), evento
-- criado com id determinístico (409 conferido), remarcação por versão (patch),
-- e alteração externa vira reconciliação, não reoferta.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS meeting_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  closer_id         UUID NOT NULL,
  conversation_id   UUID,
  origem            TEXT NOT NULL DEFAULT 'agente',      -- ana_ligacao | agente_email | humano
  execution_id      TEXT,                                 -- idempotência do chamador (n8n)
  versao            INTEGER NOT NULL DEFAULT 1,
  estado            TEXT NOT NULL DEFAULT 'aberta'
                    CHECK (estado IN ('aberta', 'slot_reservado', 'evento_criado', 'confirmada', 'cancelada', 'conflito')),
  slot_start        TIMESTAMPTZ,
  slot_end          TIMESTAMPTZ,
  google_event_id   TEXT,
  meet_link         TEXT,
  html_link         TEXT,
  interaction_id    UUID,
  erro              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Uma solicitação ativa por lead, compartilhada por ligação e e-mail
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_requests_lead_ativa
  ON meeting_requests (lead_id) WHERE estado IN ('aberta', 'slot_reservado', 'evento_criado', 'confirmada', 'conflito');
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_requests_execution ON meeting_requests (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_requests_org_estado ON meeting_requests (org_id, estado);
ALTER TABLE meeting_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meeting_requests_org ON meeting_requests;
CREATE POLICY meeting_requests_org ON meeting_requests FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());
DROP TRIGGER IF EXISTS set_updated_at ON meeting_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meeting_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Reserva atômica por closer e intervalo: dois leads no mesmo horário → um INSERT falha
CREATE TABLE IF NOT EXISTS calendar_slots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  closer_id           UUID NOT NULL,
  slot_start          TIMESTAMPTZ NOT NULL,
  slot_end            TIMESTAMPTZ NOT NULL,
  meeting_request_id  UUID NOT NULL REFERENCES meeting_requests(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start),
  CONSTRAINT calendar_slots_sem_sobreposicao
    EXCLUDE USING gist (closer_id WITH =, tstzrange(slot_start, slot_end, '[)') WITH &&)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_slots_closer_start ON calendar_slots (closer_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_calendar_slots_request ON calendar_slots (meeting_request_id);
ALTER TABLE calendar_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_slots_org ON calendar_slots;
CREATE POLICY calendar_slots_org ON calendar_slots FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

-- Conciliação com o calendário do closer a cada 15 min
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-meeting-requests') THEN
    PERFORM cron.unschedule('reconcile-meeting-requests');
  END IF;
  PERFORM cron.schedule(
    'reconcile-meeting-requests',
    '*/15 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://app.enriqueceai.com.br/api/cron/reconcile-meeting-requests',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;

COMMIT;

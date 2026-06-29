-- Epic 7 (Ligação via WhatsApp) — gravação: buffer de gravações recebidas via
-- webhook do AstraCalls ANTES de a `call` ser persistida.
--
-- Timing: a gravação fica pronta no AstraCalls ~no fim da ligação, mas a linha em
-- `calls` só é criada quando o SDR conclui o modal de resultado (segundos/minutos
-- depois). Então o webhook /api/webhooks/wacalls quase sempre chega antes da call
-- existir. Ele grava aqui (idempotente por service_call_id) e o persistWhatsAppCall
-- consome este buffer ao criar a call. Se o webhook chegar depois (call já existe),
-- ele atualiza `calls.recording_url` direto — este buffer cobre só a corrida.
--
-- Acesso exclusivo via service_role (webhook + persist) — sem policies de usuário.

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_pending_recordings (
  service_call_id TEXT PRIMARY KEY,
  recording_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE whatsapp_pending_recordings IS
  'Buffer: gravações WhatsApp recebidas pelo webhook do AstraCalls antes da call ser persistida. Consumido por persistWhatsAppCall via service_call_id. Ver Epic 7 gravação.';

ALTER TABLE whatsapp_pending_recordings ENABLE ROW LEVEL SECURITY;
-- Sem policies: buffer técnico acessado só por service_role (RLS bypass).

COMMIT;

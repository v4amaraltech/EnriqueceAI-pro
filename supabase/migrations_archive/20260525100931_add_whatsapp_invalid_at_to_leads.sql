BEGIN;

-- Mirror of email_bounced_at: marks leads whose phone number is not on WhatsApp.
-- Set by SDR via "Não é WhatsApp" feedback button when executing a WhatsApp activity.
-- Used by fetch-pending-activities to suppress future WhatsApp steps for the lead.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_invalid_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.whatsapp_invalid_at IS
  'Quando preenchido, indica que o telefone do lead não é WhatsApp (feedback do SDR). Steps de WhatsApp são suprimidos da fila enquanto este campo não for nulo.';

CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_invalid
  ON leads (whatsapp_invalid_at)
  WHERE whatsapp_invalid_at IS NOT NULL;

COMMIT;

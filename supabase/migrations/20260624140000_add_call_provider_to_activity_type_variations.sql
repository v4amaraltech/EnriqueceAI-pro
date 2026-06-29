-- Activity-type variations can be call variations that use the WhatsApp dialer
-- (channel='phone', callProvider='whatsapp'), introduced by the WhatsApp-calls
-- epic. Persist that discriminator so custom "WhatsApp Ligação" variations keep
-- their dialer when reloaded, instead of degrading to a regular PSTN call.

BEGIN;

ALTER TABLE activity_type_variations
  ADD COLUMN IF NOT EXISTS call_provider TEXT
    CHECK (call_provider IS NULL OR call_provider IN ('whatsapp'));

COMMIT;

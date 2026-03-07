BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS phones JSONB DEFAULT '[]';

COMMENT ON COLUMN leads.phones IS 'Additional phone numbers: [{"tipo": "celular"|"fixo"|"whatsapp", "numero": "+55 31 99587-9787"}]';

COMMIT;

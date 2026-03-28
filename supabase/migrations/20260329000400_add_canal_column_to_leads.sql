BEGIN;

-- Add "canal" as a standard column on leads (acquisition channel)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS canal TEXT;

COMMIT;

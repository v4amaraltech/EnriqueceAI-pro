-- Add social media fields to leads table

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT;

COMMIT;

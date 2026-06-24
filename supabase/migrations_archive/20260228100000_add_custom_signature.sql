BEGIN;

ALTER TABLE gmail_connections
  ADD COLUMN IF NOT EXISTS custom_signature TEXT;

COMMIT;

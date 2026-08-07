BEGIN;

-- Convert crm_connections.credentials_encrypted from JSONB to TEXT
-- This allows storing AES-256-GCM encrypted strings (iv:tag:ciphertext format)
-- instead of raw JSON objects.
--
-- Existing JSONB values are converted to their JSON text representation,
-- which the application's decryptJson() handles via backward compatibility.

ALTER TABLE crm_connections
  ALTER COLUMN credentials_encrypted
  SET DATA TYPE TEXT
  USING credentials_encrypted::TEXT;

COMMIT;

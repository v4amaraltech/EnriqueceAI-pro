BEGIN;

ALTER TABLE api4com_connections ADD COLUMN IF NOT EXISTS sip_domain TEXT;
ALTER TABLE api4com_connections ADD COLUMN IF NOT EXISTS sip_password_encrypted TEXT;

COMMIT;

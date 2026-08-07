BEGIN;

-- Add 'kommo' to the crm_type enum
ALTER TYPE crm_type ADD VALUE IF NOT EXISTS 'kommo';

COMMIT;

BEGIN;

-- Add contact-person fields to leads table for outbound sales workflow
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_inbound BOOLEAN NOT NULL DEFAULT false;

COMMIT;

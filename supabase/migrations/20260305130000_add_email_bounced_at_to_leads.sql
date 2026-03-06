BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMPTZ;

-- Index for quick bounce checks in cadence engine
CREATE INDEX IF NOT EXISTS idx_leads_email_bounced ON leads (email_bounced_at) WHERE email_bounced_at IS NOT NULL;

COMMIT;

BEGIN;

-- External identifier from lead source (e.g., Apollo person ID).
-- Used by webhooks to match async data back to the correct lead.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_source_id ON leads (source_id) WHERE source_id IS NOT NULL;

COMMIT;

BEGIN;

-- Add emails JSONB array to leads (multiple emails with type)
-- Same pattern as phones JSONB
ALTER TABLE leads ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT NULL;

COMMENT ON COLUMN leads.emails IS 'Array of {tipo, email} objects. When set (even []), is the source of truth for emails. null = never edited.';

COMMIT;

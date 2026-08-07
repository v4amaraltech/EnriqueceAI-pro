BEGIN;

-- Add metadata column to calls table for API4COM correlation
ALTER TABLE calls ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN calls.metadata IS 'Stores integration metadata (e.g. api4com_call_id for webhook correlation)';

COMMIT;

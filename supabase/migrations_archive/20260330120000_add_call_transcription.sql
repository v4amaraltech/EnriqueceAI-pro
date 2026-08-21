BEGIN;

-- Add transcription fields to calls table for automatic speech-to-text + SPICED analysis
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcription TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcription_status TEXT DEFAULT 'pending'
  CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcription_error TEXT;

COMMIT;

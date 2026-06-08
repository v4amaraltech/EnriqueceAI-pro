-- Make auto_skip_ineligible_call_transcription fire on UPDATE too. The n8n
-- API4COM pipeline creates calls with duration_seconds=0 / status NULL and
-- patches the metadata in a follow-up UPDATE. The original BEFORE INSERT
-- trigger evaluated the row before that update arrived, so calls that should
-- have been skipped (duration < 30s, not_connected, etc.) sat in 'pending'
-- forever. Cleaned 9 such orphans on V4 Amaral on 2026-05-10.
--
-- Triggering on UPDATE is safe because the function bails out if
-- transcription_status is already non-pending, so it will not overwrite
-- successful or failed transcriptions.

DROP TRIGGER IF EXISTS auto_skip_ineligible_call_transcription ON calls;

CREATE TRIGGER auto_skip_ineligible_call_transcription
BEFORE INSERT OR UPDATE ON calls
FOR EACH ROW
EXECUTE FUNCTION auto_skip_ineligible_call_transcription();

-- Prevent duplicate pending feedback requests for the same lead + closer
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique_pending
ON closer_feedback_requests (lead_id, closer_id)
WHERE responded_at IS NULL;

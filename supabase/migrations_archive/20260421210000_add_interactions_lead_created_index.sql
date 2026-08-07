-- H4: Add composite index for calculate_engagement_score() performance
-- Prevents full table scan when computing score per lead
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_lead_created
  ON interactions (lead_id, created_at DESC);

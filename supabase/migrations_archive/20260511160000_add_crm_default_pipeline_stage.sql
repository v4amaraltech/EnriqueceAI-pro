-- Adds default pipeline/stage/responsible columns to crm_connections.
-- Used by the closer-feedback flow (/api/feedback with result='meeting_done')
-- to push leads to the CRM automatically, since that path no longer goes
-- through the UI's markLeadAsWon (which gathered these from the user form).
--
-- 30% of won leads in production (25 of 82 for V4 Amaral) had reached
-- status='won' via the DB trigger but were never pushed to Kommo because
-- the feedback route had no pipeline/stage to write into.

BEGIN;

ALTER TABLE crm_connections
  ADD COLUMN IF NOT EXISTS default_pipeline_id TEXT,
  ADD COLUMN IF NOT EXISTS default_stage_id TEXT,
  ADD COLUMN IF NOT EXISTS default_responsible_user_id TEXT;

-- Backfill defaults from the most recent crm_deal_created interaction per org.
-- We pick the latest deal because pipeline/stage might have changed over time;
-- the latest reflects the current operating state.
WITH latest_deal AS (
  SELECT DISTINCT ON (org_id)
    org_id,
    metadata->>'pipeline_id' AS pipeline_id,
    metadata->>'stage_id'    AS stage_id
  FROM interactions
  WHERE type = 'crm_deal_created'
    AND metadata ? 'pipeline_id'
    AND metadata ? 'stage_id'
  ORDER BY org_id, created_at DESC
)
UPDATE crm_connections c
SET default_pipeline_id = ld.pipeline_id,
    default_stage_id    = ld.stage_id
FROM latest_deal ld
WHERE c.org_id = ld.org_id
  AND c.default_pipeline_id IS NULL;

COMMIT;

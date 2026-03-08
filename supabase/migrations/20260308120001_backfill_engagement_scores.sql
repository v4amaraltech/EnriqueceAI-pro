BEGIN;

-- Backfill engagement_score for existing leads that have interactions
UPDATE leads
SET engagement_score = calculate_engagement_score(id),
    updated_at = now()
WHERE deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM interactions WHERE lead_id = leads.id);

COMMIT;

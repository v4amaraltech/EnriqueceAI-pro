-- Migration: Add fit_score column to leads
-- Story 3.13: Fit Score Engine

ALTER TABLE leads ADD COLUMN fit_score INTEGER;

CREATE INDEX idx_leads_fit_score ON leads(org_id, fit_score DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Rollback
-- DROP INDEX idx_leads_fit_score;
-- ALTER TABLE leads DROP COLUMN fit_score;

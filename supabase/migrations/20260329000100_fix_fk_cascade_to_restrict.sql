BEGIN;

-- =============================================================================
-- Migration: Protect audit data from cascading lead hard-deletes
-- =============================================================================
-- Problem: interactions, cadence_enrollments, and enrichment_attempts use
-- ON DELETE CASCADE on lead_id. If a lead is accidentally hard-deleted
-- (instead of soft-deleted via deleted_at), ALL interaction history,
-- enrollment records, and enrichment audit trail are silently destroyed.
--
-- Fix: Change CASCADE to NO ACTION. This:
--   1. Prevents individual lead hard-delete from cascading (DELETE fails)
--   2. Still allows org-wide cleanup (DELETE FROM organizations CASCADE works
--      because interactions/enrollments are first deleted via their own
--      org_id CASCADE, then leads can be deleted with no FK violations)
--   3. Soft delete (UPDATE deleted_at) is unaffected by FK constraints
--
-- Note: NO ACTION (not RESTRICT) is used because it's checked at statement
-- end, allowing multi-table cascading deletes from organization deletion
-- to resolve correctly.
-- =============================================================================

-- interactions.lead_id → leads: CASCADE → NO ACTION
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_lead_id_fkey;
ALTER TABLE interactions ADD CONSTRAINT interactions_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE NO ACTION;

-- cadence_enrollments.lead_id → leads: CASCADE → NO ACTION
ALTER TABLE cadence_enrollments DROP CONSTRAINT IF EXISTS cadence_enrollments_lead_id_fkey;
ALTER TABLE cadence_enrollments ADD CONSTRAINT cadence_enrollments_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE NO ACTION;

-- enrichment_attempts.lead_id → leads: CASCADE → NO ACTION
ALTER TABLE enrichment_attempts DROP CONSTRAINT IF EXISTS enrichment_attempts_lead_id_fkey;
ALTER TABLE enrichment_attempts ADD CONSTRAINT enrichment_attempts_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE NO ACTION;

-- subscriptions.plan_id → plans: make ON DELETE RESTRICT explicit
-- (already defaults to NO ACTION, but explicit is better for documentation)
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT;

-- webhook_events.status: add CHECK constraint for valid values
-- (currently TEXT with no validation — constrain to known statuses)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_webhook_events_status'
  ) THEN
    ALTER TABLE webhook_events ADD CONSTRAINT chk_webhook_events_status
      CHECK (status IN ('pending', 'processed', 'failed', 'dead_letter'));
  END IF;
END $$;

COMMIT;

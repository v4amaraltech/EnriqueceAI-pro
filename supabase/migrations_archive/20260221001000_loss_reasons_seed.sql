-- ============================================================================
-- Story 3.10: Seed default loss reasons + add sort_order column
-- ============================================================================
-- ROLLBACK: DELETE FROM loss_reasons WHERE is_system = true;
--           ALTER TABLE loss_reasons DROP COLUMN IF EXISTS sort_order;
-- ============================================================================

BEGIN;

-- Add sort_order column for UI ordering
ALTER TABLE loss_reasons ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Seed 6 default system reasons (idempotent: only insert if none exist for the org)
-- These are inserted per-org when the org first visits the settings page,
-- using the server action. Here we define the canonical defaults for reference.
-- Actual seeding happens in the app layer to scope per org_id.

COMMIT;

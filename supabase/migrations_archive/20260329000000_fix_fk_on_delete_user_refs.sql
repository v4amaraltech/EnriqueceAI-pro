BEGIN;

-- =============================================================================
-- Migration: Fix ON DELETE clauses on user/closer reference FKs
-- =============================================================================
-- Problem: Several FKs referencing auth.users(id) or closers(id) default to
-- NO ACTION, which blocks user account deletion (GDPR, offboarding) if any
-- records reference that user. These are attribution columns (created_by,
-- won_by, enrolled_by) — the records should be preserved with NULL reference.
--
-- Fix: Change to ON DELETE SET NULL so user/closer deletion succeeds while
-- preserving the referencing records for audit trail.
-- =============================================================================

-- leads.created_by → auth.users
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_created_by_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- leads.won_by → auth.users
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_won_by_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_won_by_fkey
  FOREIGN KEY (won_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- leads.closer_id → closers (closer soft-deleted but could be hard-deleted)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_closer_id_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_closer_id_fkey
  FOREIGN KEY (closer_id) REFERENCES closers(id) ON DELETE SET NULL;

-- cadences.created_by → auth.users
ALTER TABLE cadences DROP CONSTRAINT IF EXISTS cadences_created_by_fkey;
ALTER TABLE cadences ADD CONSTRAINT cadences_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- message_templates.created_by → auth.users
ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_created_by_fkey;
ALTER TABLE message_templates ADD CONSTRAINT message_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- lead_imports.created_by → auth.users
ALTER TABLE lead_imports DROP CONSTRAINT IF EXISTS lead_imports_created_by_fkey;
ALTER TABLE lead_imports ADD CONSTRAINT lead_imports_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- activity_templates.created_by → auth.users
ALTER TABLE activity_templates DROP CONSTRAINT IF EXISTS activity_templates_created_by_fkey;
ALTER TABLE activity_templates ADD CONSTRAINT activity_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- cadence_enrollments.enrolled_by → auth.users
ALTER TABLE cadence_enrollments DROP CONSTRAINT IF EXISTS cadence_enrollments_enrolled_by_fkey;
ALTER TABLE cadence_enrollments ADD CONSTRAINT cadence_enrollments_enrolled_by_fkey
  FOREIGN KEY (enrolled_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

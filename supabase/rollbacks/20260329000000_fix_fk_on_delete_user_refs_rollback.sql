BEGIN;

-- Rollback: Revert ON DELETE SET NULL back to NO ACTION (default)

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_created_by_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_won_by_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_won_by_fkey
  FOREIGN KEY (won_by) REFERENCES auth.users(id);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_closer_id_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_closer_id_fkey
  FOREIGN KEY (closer_id) REFERENCES closers(id);

ALTER TABLE cadences DROP CONSTRAINT IF EXISTS cadences_created_by_fkey;
ALTER TABLE cadences ADD CONSTRAINT cadences_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_created_by_fkey;
ALTER TABLE message_templates ADD CONSTRAINT message_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE lead_imports DROP CONSTRAINT IF EXISTS lead_imports_created_by_fkey;
ALTER TABLE lead_imports ADD CONSTRAINT lead_imports_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE activity_templates DROP CONSTRAINT IF EXISTS activity_templates_created_by_fkey;
ALTER TABLE activity_templates ADD CONSTRAINT activity_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE cadence_enrollments DROP CONSTRAINT IF EXISTS cadence_enrollments_enrolled_by_fkey;
ALTER TABLE cadence_enrollments ADD CONSTRAINT cadence_enrollments_enrolled_by_fkey
  FOREIGN KEY (enrolled_by) REFERENCES auth.users(id);

COMMIT;

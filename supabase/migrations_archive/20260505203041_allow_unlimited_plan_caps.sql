BEGIN;

-- The plans table uses -1 to mean "no cap" (e.g. Enterprise.max_ai_per_day,
-- Internal.*). The original check constraints required strictly positive
-- values, which prevented setting max_leads or included_users to -1.
-- Relax both so any positive count or the sentinel -1 is accepted; 0 stays
-- forbidden because the codebase treats it as a misconfiguration.

ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plans_max_leads;
ALTER TABLE plans ADD CONSTRAINT chk_plans_max_leads
  CHECK (max_leads = -1 OR max_leads > 0);

ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plans_included_users;
ALTER TABLE plans ADD CONSTRAINT chk_plans_included_users
  CHECK (included_users = -1 OR included_users > 0);

COMMIT;

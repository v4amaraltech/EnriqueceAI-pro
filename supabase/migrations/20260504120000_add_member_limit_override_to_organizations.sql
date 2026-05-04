BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS member_limit_override INTEGER NULL;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS chk_organizations_member_limit_override;

ALTER TABLE organizations
  ADD CONSTRAINT chk_organizations_member_limit_override
  CHECK (member_limit_override IS NULL OR member_limit_override > 0);

COMMENT ON COLUMN organizations.member_limit_override IS
  'Per-org override for the member seat limit. When NULL, the limit comes from plans.included_users via the active subscription.';

COMMIT;

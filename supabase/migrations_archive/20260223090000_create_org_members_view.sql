BEGIN;

-- View alias: the deployed edge functions reference "org_members"
-- but our table is "organization_members". This view bridges the gap.
CREATE OR REPLACE VIEW org_members AS
  SELECT * FROM organization_members;

-- Grant same permissions so service-role queries work
GRANT SELECT, INSERT, UPDATE, DELETE ON org_members TO service_role;
GRANT SELECT ON org_members TO authenticated;

COMMIT;

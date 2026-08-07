-- Auto-tier calculation requires the trigger to know, for each org, which
-- custom_field is the input (faturamento broker) and which is the output (tier).
-- Matching by field_name is fragile: managers can rename fields from the UI.
--
-- Add a stable system_key column that the trigger looks up instead:
--   * 'tier_input'  → Faturamento Broker (numeric source)
--   * 'tier_output' → Tier (select target)
--
-- Nullable on purpose: most custom_fields are user-defined and don't need a
-- system_key. The partial UNIQUE index prevents two fields in the same org
-- claiming the same role.

BEGIN;

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS system_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_org_system_key_uniq
  ON custom_fields (org_id, system_key)
  WHERE system_key IS NOT NULL;

COMMENT ON COLUMN custom_fields.system_key IS
  'Stable identifier for system-managed custom_fields used by triggers/automations. NULL for user-defined fields. Known keys: tier_input (Faturamento Broker), tier_output (Tier).';

-- Stamp existing V4 Amaral fields. Done as a parametrized UPDATE rather than
-- by hardcoded UUIDs so the migration stays portable if other orgs already
-- created equivalent fields (case-insensitive match on field_name).
UPDATE custom_fields
SET system_key = 'tier_output'
WHERE system_key IS NULL
  AND lower(field_name) = 'tier';

UPDATE custom_fields
SET system_key = 'tier_input'
WHERE system_key IS NULL
  AND lower(field_name) IN ('faturamento broker', 'faturamento_broker');

COMMIT;

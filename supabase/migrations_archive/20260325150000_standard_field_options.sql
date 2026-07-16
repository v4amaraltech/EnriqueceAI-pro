BEGIN;

ALTER TABLE standard_field_settings ADD COLUMN IF NOT EXISTS options JSONB;

COMMENT ON COLUMN standard_field_settings.options IS 'Custom options for select-type standard fields (e.g. lead_source). Stores a JSON array of strings.';

COMMIT;

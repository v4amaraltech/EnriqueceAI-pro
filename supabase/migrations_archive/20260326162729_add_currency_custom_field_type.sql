BEGIN;

-- Drop the old CHECK constraint and add updated one with all field types
ALTER TABLE custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;

ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_field_type_check
  CHECK (field_type IN ('text', 'textarea', 'number', 'currency', 'date', 'datetime', 'select'));

COMMIT;

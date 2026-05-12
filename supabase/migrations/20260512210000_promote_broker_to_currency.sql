-- The tier auto-calculation reads Faturamento Broker as a numeric value. The
-- field was originally created as 'text', which would force a fragile parser
-- on the trigger side ("R$ 1.500.000", "1,5MM", etc).
--
-- Switch every tier_input field to 'currency' so the UI renders a currency
-- input and the stored value is a clean number string. Currency type was
-- added in migration 20260326162729_add_currency_custom_field_type.sql.
--
-- Safe to run repeatedly: no-op when field is already 'currency'. No row
-- data conversion needed because Faturamento Broker has 0 values populated
-- at this point (verified via 'SELECT COUNT(*) WHERE custom_field_values ?
-- <field_id>').

BEGIN;

UPDATE custom_fields
SET field_type = 'currency'
WHERE system_key = 'tier_input'
  AND field_type <> 'currency';

COMMIT;

BEGIN;

-- Update dialer preferences constraints to match Meetime screenshot ranges
-- simultaneous_phones: 2-4 (was 1-10), default 2 (was 4)
-- daily_limit_per_lead: 1-10 (was 1-20), default stays 3

-- Drop old constraints
ALTER TABLE organization_call_settings
  DROP CONSTRAINT IF EXISTS chk_dialer_simultaneous_phones;

ALTER TABLE organization_call_settings
  DROP CONSTRAINT IF EXISTS chk_dialer_daily_limit_per_lead;

-- Update default for simultaneous_phones from 4 to 2
ALTER TABLE organization_call_settings
  ALTER COLUMN dialer_simultaneous_phones SET DEFAULT 2;

-- Clamp existing values to new range before adding constraint
UPDATE organization_call_settings
  SET dialer_simultaneous_phones = LEAST(GREATEST(dialer_simultaneous_phones, 2), 4)
  WHERE dialer_simultaneous_phones < 2 OR dialer_simultaneous_phones > 4;

UPDATE organization_call_settings
  SET dialer_daily_limit_per_lead = LEAST(GREATEST(dialer_daily_limit_per_lead, 1), 10)
  WHERE dialer_daily_limit_per_lead > 10;

-- Add new tighter constraints
ALTER TABLE organization_call_settings
  ADD CONSTRAINT chk_dialer_simultaneous_phones
    CHECK (dialer_simultaneous_phones >= 2 AND dialer_simultaneous_phones <= 4);

ALTER TABLE organization_call_settings
  ADD CONSTRAINT chk_dialer_daily_limit_per_lead
    CHECK (dialer_daily_limit_per_lead >= 1 AND dialer_daily_limit_per_lead <= 10);

COMMIT;

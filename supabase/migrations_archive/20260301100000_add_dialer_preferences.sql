BEGIN;

-- Add dialer preferences to existing organization_call_settings table
ALTER TABLE organization_call_settings
  ADD COLUMN IF NOT EXISTS dialer_simultaneous_phones INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS dialer_daily_limit_per_lead INTEGER NOT NULL DEFAULT 3;

-- Constraints for valid ranges
ALTER TABLE organization_call_settings
  ADD CONSTRAINT chk_dialer_simultaneous_phones
    CHECK (dialer_simultaneous_phones >= 1 AND dialer_simultaneous_phones <= 10);

ALTER TABLE organization_call_settings
  ADD CONSTRAINT chk_dialer_daily_limit_per_lead
    CHECK (dialer_daily_limit_per_lead >= 1 AND dialer_daily_limit_per_lead <= 20);

COMMIT;

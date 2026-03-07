BEGIN;

ALTER TABLE cadence_steps ADD COLUMN IF NOT EXISTS ab_winner_variant TEXT CHECK (ab_winner_variant IN ('A', 'B'));
ALTER TABLE cadence_steps ADD COLUMN IF NOT EXISTS ab_winner_at TIMESTAMPTZ;
ALTER TABLE cadence_steps ADD COLUMN IF NOT EXISTS ab_enabled_at TIMESTAMPTZ;

COMMIT;

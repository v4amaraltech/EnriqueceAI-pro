-- Story 3.7: Add phone, linkedin, research to channel_type enum
-- These are needed for the cadence timeline builder sidebar

ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'phone';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'linkedin';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'research';

-- Rollback: PostgreSQL does not support removing enum values.
-- To rollback, recreate the type without these values (requires dropping dependent columns first).

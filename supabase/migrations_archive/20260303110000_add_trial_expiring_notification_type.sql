-- ============================================================================
-- Add 'trial_expiring' to notification_type enum
-- ============================================================================
-- Used by the expire-trials cron to notify managers 7 days before trial ends.
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction block.
-- ============================================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trial_expiring';

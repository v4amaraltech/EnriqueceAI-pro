-- Add CRM-specific enum values for interaction tracking
-- Used by crm-sync.service.ts (crm_synced) and markLeadAsWon (crm_deal_created)
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction block

ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'crm_synced';
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'crm_deal_created';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'crm';

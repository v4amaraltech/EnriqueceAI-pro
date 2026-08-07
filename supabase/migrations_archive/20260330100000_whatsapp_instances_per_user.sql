BEGIN;

-- Allow multiple WhatsApp instances per org (one per user)
-- Add user_id column to whatsapp_instances
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Drop the old unique constraint (one instance per org)
ALTER TABLE whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_org_id_key;

-- Add new unique constraint (one instance per user per org)
-- user_id NULL = org-level default instance
ALTER TABLE whatsapp_instances ADD CONSTRAINT whatsapp_instances_org_user_key UNIQUE (org_id, user_id);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_user_id ON whatsapp_instances (user_id) WHERE user_id IS NOT NULL;

-- Assign existing instance to NULL user_id (org-level default) — already the case since column defaults to NULL

COMMIT;

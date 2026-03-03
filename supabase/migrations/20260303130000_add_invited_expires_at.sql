BEGIN;

-- Add expiration column for invite flow
ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS invited_expires_at TIMESTAMPTZ;

-- Set default expiry for existing invited members (7 days from now)
UPDATE organization_members
SET invited_expires_at = now() + INTERVAL '7 days'
WHERE status = 'invited' AND invited_expires_at IS NULL;

COMMIT;

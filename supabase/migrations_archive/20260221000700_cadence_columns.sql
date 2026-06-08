-- Story 3.6: Add priority, origin, type columns to cadences table

ALTER TABLE cadences
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high', 'medium', 'low')),
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'outbound'
    CHECK (origin IN ('inbound_active', 'inbound_passive', 'outbound')),
  ADD COLUMN type TEXT NOT NULL DEFAULT 'standard'
    CHECK (type IN ('standard', 'auto_email'));

-- Rollback:
-- ALTER TABLE cadences DROP COLUMN priority, DROP COLUMN origin, DROP COLUMN type;

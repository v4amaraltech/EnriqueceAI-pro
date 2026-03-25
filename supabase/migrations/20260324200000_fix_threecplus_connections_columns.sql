BEGIN;

-- Fix: rename columns to match application code
-- The table was initially created with 'extension' and 'base_url' columns
-- but the application code uses 'login' and 'domain'
ALTER TABLE threecplus_connections RENAME COLUMN extension TO login;
ALTER TABLE threecplus_connections RENAME COLUMN base_url TO domain;

-- Remove old default (domain stores just the subdomain, not full URL)
ALTER TABLE threecplus_connections ALTER COLUMN domain DROP DEFAULT;

COMMIT;

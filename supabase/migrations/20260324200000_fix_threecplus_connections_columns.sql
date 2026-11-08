BEGIN;

-- Fix: rename columns to match application code
-- The table was initially created with 'extension' and 'base_url' columns
-- but the application code uses 'login' and 'domain'.
-- Idempotent: on fresh databases the create migration already uses login/domain (no-op).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'threecplus_connections' AND column_name = 'extension'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'threecplus_connections' AND column_name = 'login'
  ) THEN
    ALTER TABLE public.threecplus_connections RENAME COLUMN extension TO login;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'threecplus_connections' AND column_name = 'base_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'threecplus_connections' AND column_name = 'domain'
  ) THEN
    ALTER TABLE public.threecplus_connections RENAME COLUMN base_url TO domain;
  END IF;

  -- Remove old default (domain stores just the subdomain, not full URL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'threecplus_connections' AND column_name = 'domain'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE public.threecplus_connections ALTER COLUMN domain DROP DEFAULT;
  END IF;
END $$;

COMMIT;

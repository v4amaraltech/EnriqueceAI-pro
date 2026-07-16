BEGIN;

-- Three client-side postgres_changes subscriptions were silently dead because
-- the publication only included 'notifications' and 'calls':
--   - ActivityLeadContext listens to interactions for live timeline updates
--   - OrganizationProvider listens to organizations for live org settings
--   - OrganizationProvider listens to organization_members for invite/remove

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'interactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.interactions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'organizations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.organizations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'organization_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_members;
  END IF;
END $$;

COMMIT;

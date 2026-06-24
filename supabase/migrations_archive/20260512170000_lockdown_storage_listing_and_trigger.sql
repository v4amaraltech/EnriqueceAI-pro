-- Two security advisors flagged by the Supabase linter (2026-05-12):
--
-- 1. public_bucket_allows_listing on `avatars` and `org-logos` — both have a
--    SELECT policy `bucket_id = '<bucket>'` granted to `public`, which gives
--    anonymous clients the ability to LIST all files. Public buckets serve
--    individual objects via getPublicUrl() without RLS, so listing isn't
--    needed for normal read access.
--
--    avatars: nothing in the app code calls `.list()` on this bucket → drop
--    the public SELECT entirely. Visualization keeps working through
--    user.avatar_url URLs.
--
--    org-logos: upload-org-logo.ts:97 calls `.list(member.org_id)` to remove
--    older logos when a new one is uploaded → replace the public SELECT with
--    an authenticated, org-scoped policy.
--
-- 2. function_search_path_mutable on set_qualified_at — the trigger function
--    didn't pin its search_path, leaving it open to schema-shadowing attacks.
--    Add SET search_path = public, pg_catalog (same defensive pattern other
--    Supabase-generated functions use).

BEGIN;

-- 1a. Lock down avatars: no public SELECT, no listing
DROP POLICY IF EXISTS "Anyone can read avatars" ON storage.objects;

-- 1b. org-logos: replace overly broad SELECT with authenticated org-scoped one
DROP POLICY IF EXISTS "Anyone can read org logos" ON storage.objects;

CREATE POLICY "Org members list own logos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (user_org_id())::text
  );

-- 2. Pin search_path on set_qualified_at. Replicates the trigger body from
-- 20260512100000 (clear_won_at_on_unqualify) so SET search_path takes effect.
CREATE OR REPLACE FUNCTION set_qualified_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.status = 'unqualified' AND OLD.status IS DISTINCT FROM 'unqualified' THEN
    NEW.lost_at := now();
    NEW.won_at := NULL;
    NEW.meeting_held_at := NULL;
  END IF;

  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

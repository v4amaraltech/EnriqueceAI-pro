-- Profile photo upload was failing with "new row violates row-level security
-- policy" (42501) when re-uploading. Tracing showed the `avatars` bucket is
-- public (storage.buckets.public = true) but storage.objects had NO SELECT
-- policy for it — only INSERT/UPDATE/DELETE scoped to the user's own folder.
--
-- The Supabase Storage REST API runs as the JWT user (`authenticated`); when
-- it can't SELECT the row that already exists at `<uid>/avatar.png`, the
-- upsert collapses into a plain INSERT and trips the WITH CHECK on a path
-- with a conflicting row. Adding a public SELECT policy mirrors the bucket's
-- `public: true` flag and unblocks the upload flow without weakening writes
-- (which stay locked to the owner's folder).

BEGIN;

CREATE POLICY "Anyone can read avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

COMMIT;

BEGIN;

-- Create public bucket for organization logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Org members can upload logo to their org folder
CREATE POLICY "Org members can upload logo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.user_org_id()::text);

-- Org members can update their org logo
CREATE POLICY "Org members can update logo" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.user_org_id()::text);

-- Anyone can read org logos (public bucket)
CREATE POLICY "Anyone can read org logos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'org-logos');

-- Org members can delete their org logo
CREATE POLICY "Org members can delete logo" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'org-logos' AND (storage.foldername(name))[1] = public.user_org_id()::text);

COMMIT;

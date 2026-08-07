BEGIN;

-- The interactions table was originally append-only (SELECT + INSERT).
-- Meeting edit/delete features require UPDATE and DELETE policies.

CREATE POLICY "interactions_org_update" ON interactions FOR UPDATE
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "interactions_org_delete" ON interactions FOR DELETE
  USING (org_id = public.user_org_id());

COMMIT;

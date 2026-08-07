BEGIN;

-- Simplify custom_fields RLS: use helper functions instead of subqueries (performance)
DROP POLICY IF EXISTS custom_fields_select ON custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;

CREATE POLICY custom_fields_select ON custom_fields FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY custom_fields_insert ON custom_fields FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY custom_fields_update ON custom_fields FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

-- Simplify email_blacklist RLS
DROP POLICY IF EXISTS email_blacklist_select ON email_blacklist;
DROP POLICY IF EXISTS email_blacklist_insert ON email_blacklist;
DROP POLICY IF EXISTS email_blacklist_delete ON email_blacklist;

CREATE POLICY email_blacklist_select ON email_blacklist FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY email_blacklist_insert ON email_blacklist FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY email_blacklist_delete ON email_blacklist FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_manager());

COMMIT;

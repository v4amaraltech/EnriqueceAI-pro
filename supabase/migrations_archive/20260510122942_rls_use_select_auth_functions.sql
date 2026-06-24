-- Wrap every direct call to auth.uid() / auth.role() inside RLS policies with
-- (select ...). Postgres caches the result of (select ...) once per query
-- instead of re-evaluating the function per row, which is the optimization
-- Supabase's database linter calls auth_rls_initplan. Behavior is identical.
--
-- 26 policies across 11 tables.

BEGIN;

-- api4com_connections (4)
DROP POLICY IF EXISTS "Users can view own api4com connection"   ON public.api4com_connections;
DROP POLICY IF EXISTS "Users can insert own api4com connection" ON public.api4com_connections;
DROP POLICY IF EXISTS "Users can update own api4com connection" ON public.api4com_connections;
DROP POLICY IF EXISTS "Users can delete own api4com connection" ON public.api4com_connections;

CREATE POLICY "Users can view own api4com connection" ON public.api4com_connections
  FOR SELECT USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY "Users can insert own api4com connection" ON public.api4com_connections
  FOR INSERT WITH CHECK ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY "Users can update own api4com connection" ON public.api4com_connections
  FOR UPDATE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY "Users can delete own api4com connection" ON public.api4com_connections
  FOR DELETE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));

-- calendar_connections (4)
DROP POLICY IF EXISTS calendar_own_read   ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_own_insert ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_own_update ON public.calendar_connections;
DROP POLICY IF EXISTS calendar_own_delete ON public.calendar_connections;

CREATE POLICY calendar_own_read ON public.calendar_connections
  FOR SELECT USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY calendar_own_insert ON public.calendar_connections
  FOR INSERT WITH CHECK ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY calendar_own_update ON public.calendar_connections
  FOR UPDATE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY calendar_own_delete ON public.calendar_connections
  FOR DELETE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));

-- gmail_connections (4)
DROP POLICY IF EXISTS gmail_own_read   ON public.gmail_connections;
DROP POLICY IF EXISTS gmail_own_insert ON public.gmail_connections;
DROP POLICY IF EXISTS gmail_own_update ON public.gmail_connections;
DROP POLICY IF EXISTS gmail_own_delete ON public.gmail_connections;

CREATE POLICY gmail_own_read ON public.gmail_connections
  FOR SELECT USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY gmail_own_insert ON public.gmail_connections
  FOR INSERT WITH CHECK ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY gmail_own_update ON public.gmail_connections
  FOR UPDATE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));
CREATE POLICY gmail_own_delete ON public.gmail_connections
  FOR DELETE USING ((org_id = user_org_id()) AND (user_id = (select auth.uid())));

-- call_feedback (2) — keeps the EXISTS subquery, just wraps auth.uid()
DROP POLICY IF EXISTS call_feedback_select ON public.call_feedback;
DROP POLICY IF EXISTS call_feedback_insert ON public.call_feedback;

CREATE POLICY call_feedback_select ON public.call_feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM calls c
      JOIN organization_members om ON c.org_id = om.org_id
      WHERE c.id = call_feedback.call_id
        AND om.user_id = (select auth.uid())
        AND om.status = 'active'::member_status
    )
  );
CREATE POLICY call_feedback_insert ON public.call_feedback
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM calls c
      JOIN organization_members om ON c.org_id = om.org_id
      WHERE c.id = call_feedback.call_id
        AND om.user_id = (select auth.uid())
        AND om.status = 'active'::member_status
    )
  );

-- calls (3)
DROP POLICY IF EXISTS calls_select ON public.calls;
DROP POLICY IF EXISTS calls_insert ON public.calls;
DROP POLICY IF EXISTS calls_update ON public.calls;

CREATE POLICY calls_select ON public.calls
  FOR SELECT USING (
    org_id = (
      SELECT organization_members.org_id
      FROM organization_members
      WHERE organization_members.user_id = (select auth.uid())
        AND organization_members.status = 'active'::member_status
      LIMIT 1
    )
  );
CREATE POLICY calls_insert ON public.calls
  FOR INSERT WITH CHECK (
    org_id = (
      SELECT organization_members.org_id
      FROM organization_members
      WHERE organization_members.user_id = (select auth.uid())
        AND organization_members.status = 'active'::member_status
      LIMIT 1
    )
  );
CREATE POLICY calls_update ON public.calls
  FOR UPDATE USING (
    org_id = (
      SELECT organization_members.org_id
      FROM organization_members
      WHERE organization_members.user_id = (select auth.uid())
        AND organization_members.status = 'active'::member_status
      LIMIT 1
    )
  );

-- ldr_empresas / ldr_pipeline_log / ldr_socios (1 each, all "service_role_only")
DROP POLICY IF EXISTS service_role_only ON public.ldr_empresas;
DROP POLICY IF EXISTS service_role_only ON public.ldr_pipeline_log;
DROP POLICY IF EXISTS service_role_only ON public.ldr_socios;

CREATE POLICY service_role_only ON public.ldr_empresas
  FOR ALL USING ((select auth.role()) = 'service_role'::text);
CREATE POLICY service_role_only ON public.ldr_pipeline_log
  FOR ALL USING ((select auth.role()) = 'service_role'::text);
CREATE POLICY service_role_only ON public.ldr_socios
  FOR ALL USING ((select auth.role()) = 'service_role'::text);

-- leads (2)
DROP POLICY IF EXISTS leads_org_read   ON public.leads;
DROP POLICY IF EXISTS leads_org_update ON public.leads;

CREATE POLICY leads_org_read ON public.leads
  FOR SELECT USING (
    (org_id = user_org_id())
    AND (
      is_manager()
      OR lead_visibility_mode() = 'all'::text
      OR (
        lead_visibility_mode() = ANY (ARRAY['own'::text, 'team'::text])
        AND assigned_to = (select auth.uid())
      )
    )
  );
CREATE POLICY leads_org_update ON public.leads
  FOR UPDATE USING (
    (org_id = user_org_id())
    AND (
      is_manager()
      OR lead_visibility_mode() = 'all'::text
      OR (
        lead_visibility_mode() = ANY (ARRAY['own'::text, 'team'::text])
        AND assigned_to = (select auth.uid())
      )
    )
  );

-- notifications (3)
DROP POLICY IF EXISTS users_read_own_notifications   ON public.notifications;
DROP POLICY IF EXISTS users_update_own_notifications ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_own        ON public.notifications;

CREATE POLICY users_read_own_notifications ON public.notifications
  FOR SELECT USING ((user_id = (select auth.uid())) AND (org_id = user_org_id()));
CREATE POLICY users_update_own_notifications ON public.notifications
  FOR UPDATE USING ((user_id = (select auth.uid())) AND (org_id = user_org_id()));
CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE USING ((user_id = (select auth.uid())) AND (org_id = user_org_id()));

-- organizations (1)
DROP POLICY IF EXISTS org_owner_update ON public.organizations;

CREATE POLICY org_owner_update ON public.organizations
  FOR UPDATE USING (owner_id = (select auth.uid()));

COMMIT;

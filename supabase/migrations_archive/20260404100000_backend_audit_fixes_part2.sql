BEGIN;

-- =============================================================================
-- Backend Audit Fixes Part 2 — 2026-04-04
-- Items 4-7: FK indexes, updated_at triggers, search_path, DELETE policies
-- =============================================================================

-- Item 4: Missing FK indexes
CREATE INDEX IF NOT EXISTS idx_leads_closer_id ON leads (closer_id) WHERE closer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_won_by ON leads (won_by) WHERE won_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cadences_auto_loss_reason_id ON cadences (auto_loss_reason_id) WHERE auto_loss_reason_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cadences_created_by ON cadences (created_by);
CREATE INDEX IF NOT EXISTS idx_interactions_original_template_id ON interactions (original_template_id) WHERE original_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cadence_steps_template_id_b ON cadence_steps (template_id_b) WHERE template_id_b IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_lead_imports_created_by ON lead_imports (created_by);
CREATE INDEX IF NOT EXISTS idx_lead_imports_org_id ON lead_imports (org_id);
CREATE INDEX IF NOT EXISTS idx_lead_import_errors_import_id ON lead_import_errors (import_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_org_id ON webhook_events (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provider_events_org_id ON provider_events (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations (owner_id);
CREATE INDEX IF NOT EXISTS idx_closers_org_id ON closers (org_id);
CREATE INDEX IF NOT EXISTS idx_closer_feedback_requests_org_id ON closer_feedback_requests (org_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_activities_org_id ON scheduled_activities (org_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_goals_user_id ON daily_activity_goals (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_created_by ON goals (created_by);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_created_by ON webhook_endpoints (created_by);
CREATE INDEX IF NOT EXISTS idx_activity_templates_created_by ON activity_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys (created_by);
CREATE INDEX IF NOT EXISTS idx_message_templates_org_id ON message_templates (org_id);

-- Item 5: Missing set_updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON daily_activity_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON goals_per_user
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ldr_empresas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ldr_socios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Item 6: Fix search_path on SECURITY DEFINER functions (prevent search_path hijacking)
ALTER FUNCTION public.auto_enroll_ldr_autonomo() SET search_path = public;
ALTER FUNCTION public.buscar_proximo_decisor_para_ligar() SET search_path = public;
ALTER FUNCTION public.recalc_engagement_score(uuid) SET search_path = public;
ALTER FUNCTION public.trigger_recalc_engagement_score() SET search_path = public;
ALTER FUNCTION public.upsert_socio_lemit(text, text, text, integer, boolean, text, text, boolean) SET search_path = public;
ALTER FUNCTION public.user_org_id() SET search_path = public;
ALTER FUNCTION public.is_manager() SET search_path = public;
ALTER FUNCTION public.lead_visibility_mode() SET search_path = public;

-- Item 7: Missing DELETE policies (only where user-facing delete is needed)
CREATE POLICY scheduled_activities_org_delete ON scheduled_activities
  FOR DELETE USING (org_id = user_org_id());
CREATE POLICY notifications_delete_own ON notifications
  FOR DELETE USING (user_id = auth.uid() AND org_id = user_org_id());
CREATE POLICY calls_delete ON calls
  FOR DELETE USING (org_id = user_org_id() AND is_manager());
CREATE POLICY enrollments_via_cadence_delete ON cadence_enrollments
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM cadences
    WHERE cadences.id = cadence_enrollments.cadence_id
      AND cadences.org_id = user_org_id()
  ));

COMMIT;

BEGIN;

-- =============================================================================
-- Migration: Add missing indexes on foreign key and filter columns
-- =============================================================================
-- These columns are used in WHERE/JOIN clauses but lack indexes, causing
-- full table scans on org-scoped queries and analytics dashboards.
-- =============================================================================

-- HIGH: cadence_enrollments.org_id — enrollment dashboard queries
CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_org
  ON cadence_enrollments (org_id);

-- MEDIUM: message_templates.created_by — "show my templates" filter
CREATE INDEX IF NOT EXISTS idx_message_templates_created_by
  ON message_templates (created_by);

-- MEDIUM: cadence_steps.template_id — template dependency tracking
CREATE INDEX IF NOT EXISTS idx_cadence_steps_template_id
  ON cadence_steps (template_id);

-- MEDIUM: crm_sync_log.org_id — org-wide sync history queries
CREATE INDEX IF NOT EXISTS idx_crm_sync_log_org_id
  ON crm_sync_log (org_id);

-- LOW: call_feedback.user_id — user contribution tracking
CREATE INDEX IF NOT EXISTS idx_call_feedback_user_id
  ON call_feedback (user_id);

-- LOW: enrichment_attempts.provider — provider analytics
CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_provider
  ON enrichment_attempts (provider);

COMMIT;

BEGIN;

-- =============================================================================
-- Migration: Add missing indexes on foreign key and filter columns
-- =============================================================================
-- These columns are used in WHERE/JOIN clauses but lack indexes, causing
-- full table scans on org-scoped queries and analytics dashboards.
-- =============================================================================

-- MEDIUM: message_templates.created_by — "show my templates" filter
CREATE INDEX IF NOT EXISTS idx_message_templates_created_by
  ON message_templates (created_by);

-- MEDIUM: cadence_steps.template_id — template dependency tracking
CREATE INDEX IF NOT EXISTS idx_cadence_steps_template_id
  ON cadence_steps (template_id);

-- LOW: call_feedback.user_id — user contribution tracking
CREATE INDEX IF NOT EXISTS idx_call_feedback_user_id
  ON call_feedback (user_id);

-- LOW: enrichment_attempts.provider — provider analytics
CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_provider
  ON enrichment_attempts (provider);

COMMIT;

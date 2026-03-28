BEGIN;

DROP INDEX IF EXISTS idx_cadence_enrollments_org;
DROP INDEX IF EXISTS idx_message_templates_created_by;
DROP INDEX IF EXISTS idx_cadence_steps_template_id;
DROP INDEX IF EXISTS idx_crm_sync_log_org_id;
DROP INDEX IF EXISTS idx_call_feedback_user_id;
DROP INDEX IF EXISTS idx_enrichment_attempts_provider;

COMMIT;

BEGIN;

-- Rollback: Revert NO ACTION/RESTRICT back to CASCADE

ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_lead_id_fkey;
ALTER TABLE interactions ADD CONSTRAINT interactions_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE cadence_enrollments DROP CONSTRAINT IF EXISTS cadence_enrollments_lead_id_fkey;
ALTER TABLE cadence_enrollments ADD CONSTRAINT cadence_enrollments_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE enrichment_attempts DROP CONSTRAINT IF EXISTS enrichment_attempts_lead_id_fkey;
ALTER TABLE enrichment_attempts ADD CONSTRAINT enrichment_attempts_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans(id);

ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS chk_webhook_events_status;

COMMIT;

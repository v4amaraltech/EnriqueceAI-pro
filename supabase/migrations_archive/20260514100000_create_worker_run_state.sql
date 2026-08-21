-- Track when each background worker last ran successfully so the workers
-- themselves can compute adaptive windows (cover the entire gap since the
-- previous run instead of a fixed 1.5h) and a health-check cron can detect
-- silently-paused workers.
--
-- Single global key per job_name — these workers don't run per-org, they
-- scan all orgs each invocation.

BEGIN;

CREATE TABLE IF NOT EXISTS worker_run_state (
  job_name TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE worker_run_state ENABLE ROW LEVEL SECURITY;

-- Managers/admins can inspect worker health. Writes only via service_role.
CREATE POLICY worker_run_state_select_authenticated ON worker_run_state
  FOR SELECT TO authenticated
  USING (true);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON worker_run_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE worker_run_state IS
  'Last-known state of each background worker. job_name = stable identifier (e.g. reconcile-api4com-calls). last_success_at drives adaptive windowing in the workers themselves.';

COMMIT;

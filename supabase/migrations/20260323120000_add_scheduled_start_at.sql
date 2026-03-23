BEGIN;

ALTER TABLE cadence_enrollments
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

COMMENT ON COLUMN cadence_enrollments.scheduled_start_at
  IS 'Data agendada para ativação automática de enrollment pausado (prospecção futura)';

CREATE INDEX idx_enrollments_scheduled
  ON cadence_enrollments(scheduled_start_at)
  WHERE status = 'paused' AND scheduled_start_at IS NOT NULL;

COMMIT;

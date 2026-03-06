BEGIN;

-- A/B testing columns on cadence_steps
ALTER TABLE cadence_steps
  ADD COLUMN IF NOT EXISTS template_id_b UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ab_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ab_distribution INTEGER NOT NULL DEFAULT 50
    CHECK (ab_distribution >= 1 AND ab_distribution <= 99);

-- Index for per-step A/B metrics queries
CREATE INDEX IF NOT EXISTS idx_interactions_step_variant
  ON interactions (step_id, type) WHERE step_id IS NOT NULL;

COMMIT;

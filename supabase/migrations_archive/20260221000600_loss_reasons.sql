-- Story 3.4: Loss reasons table + loss_reason_id column on cadence_enrollments

-- Loss reasons lookup table (org-scoped, with system defaults)
CREATE TABLE loss_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loss_reasons_org ON loss_reasons(org_id);

-- RLS
ALTER TABLE loss_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loss_reasons_select_own_org"
  ON loss_reasons FOR SELECT
  USING (user_org_id() = org_id);

CREATE POLICY "loss_reasons_insert_own_org"
  ON loss_reasons FOR INSERT
  WITH CHECK (user_org_id() = org_id);

CREATE POLICY "loss_reasons_update_own_org"
  ON loss_reasons FOR UPDATE
  USING (user_org_id() = org_id);

CREATE POLICY "loss_reasons_delete_own_org"
  ON loss_reasons FOR DELETE
  USING (user_org_id() = org_id AND is_system = false);

-- Add loss_reason_id to cadence_enrollments
ALTER TABLE cadence_enrollments
  ADD COLUMN loss_reason_id UUID REFERENCES loss_reasons(id) ON DELETE SET NULL;

CREATE INDEX idx_enrollments_loss_reason ON cadence_enrollments(loss_reason_id)
  WHERE loss_reason_id IS NOT NULL;

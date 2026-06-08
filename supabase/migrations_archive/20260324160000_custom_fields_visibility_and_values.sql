BEGIN;

-- 1a. Add visibility/required control columns to custom_fields
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_required_won BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_required_lost BOOLEAN NOT NULL DEFAULT false;

-- 1b. Create standard_field_settings table (per-org config for standard fields)
CREATE TABLE IF NOT EXISTS standard_field_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  field_key TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  is_required_won BOOLEAN NOT NULL DEFAULT false,
  is_required_lost BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, field_key)
);

ALTER TABLE standard_field_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON standard_field_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: members can read, managers can write
CREATE POLICY "Members can read standard_field_settings"
  ON standard_field_settings FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "Managers can insert standard_field_settings"
  ON standard_field_settings FOR INSERT
  WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

CREATE POLICY "Managers can update standard_field_settings"
  ON standard_field_settings FOR UPDATE
  USING (org_id = public.user_org_id() AND public.is_manager());

-- 1c. Add custom_field_values JSONB column to leads
-- Format: { "<custom_field_id>": "value string" }
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS custom_field_values JSONB NOT NULL DEFAULT '{}';

COMMIT;

-- Migration: custom_fields, email_blacklist tables + organization settings columns
-- Story 3.12: Ajustes — Campos Personalizados + Blacklist + ABM + Acesso

-- ============================================================
-- 1. custom_fields table
-- ============================================================
CREATE TABLE custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select')),
  options JSONB,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_fields_org ON custom_fields(org_id);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- Select: all org members
CREATE POLICY custom_fields_select ON custom_fields
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Insert/Update/Delete: managers only
CREATE POLICY custom_fields_insert ON custom_fields
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'manager'
    )
  );

CREATE POLICY custom_fields_update ON custom_fields
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'manager'
    )
  );

CREATE POLICY custom_fields_delete ON custom_fields
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'manager'
    )
  );

-- ============================================================
-- 2. email_blacklist table
-- ============================================================
CREATE TABLE email_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, domain)
);

CREATE INDEX idx_email_blacklist_org ON email_blacklist(org_id);

ALTER TABLE email_blacklist ENABLE ROW LEVEL SECURITY;

-- Select: all org members
CREATE POLICY email_blacklist_select ON email_blacklist
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Insert/Delete: managers only
CREATE POLICY email_blacklist_insert ON email_blacklist
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'manager'
    )
  );

CREATE POLICY email_blacklist_delete ON email_blacklist
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'manager'
    )
  );

-- ============================================================
-- 3. Organization settings columns (ABM + Lead Access)
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN abm_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN abm_group_field TEXT NOT NULL DEFAULT 'razao_social',
  ADD COLUMN lead_visibility_mode TEXT NOT NULL DEFAULT 'all'
    CHECK (lead_visibility_mode IN ('all', 'own', 'team'));

-- ============================================================
-- Rollback
-- ============================================================
-- ALTER TABLE organizations DROP COLUMN lead_visibility_mode;
-- ALTER TABLE organizations DROP COLUMN abm_group_field;
-- ALTER TABLE organizations DROP COLUMN abm_enabled;
-- DROP TABLE email_blacklist;
-- DROP TABLE custom_fields;

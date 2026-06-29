-- Persist custom activity-type variations shown in the cadence builder sidebar.
--
-- Previously these variations (e.g. "Ligação 2", "WhatsApp Msg") lived only in
-- React local state, so they vanished on reload. This table stores them per
-- organization so they survive reloads and are shared across the org's members.
--
-- A variation belongs to a sidebar category via its channel:
--   email                 → E-mail
--   phone                 → Ligação
--   linkedin / whatsapp   → Social Point
--   research              → Pesquisa
-- The default items (E-mail, Ligação, LinkedIn, WhatsApp, Pesquisa) remain
-- hardcoded in the UI; only user-created variations are stored here.

BEGIN;

CREATE TABLE IF NOT EXISTS activity_type_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  channel channel_type NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_type_variations_org_id_idx
  ON activity_type_variations (org_id);

ALTER TABLE activity_type_variations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON activity_type_variations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Any org member can manage variations (mirrors cadence editability).
CREATE POLICY activity_type_variations_org_read ON activity_type_variations FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY activity_type_variations_org_insert ON activity_type_variations FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY activity_type_variations_org_update ON activity_type_variations FOR UPDATE
  USING (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY activity_type_variations_org_delete ON activity_type_variations FOR DELETE
  USING (org_id = public.user_org_id());

COMMIT;

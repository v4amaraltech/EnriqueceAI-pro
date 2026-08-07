-- Landing page lead capture form
-- Public table, no org_id. Service role only (RLS enabled, no public policies).

BEGIN;

CREATE TABLE IF NOT EXISTS landing_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  website TEXT NOT NULL,
  employees TEXT NOT NULL,
  role TEXT NOT NULL,
  sdr_count TEXT NOT NULL,
  crm TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE landing_leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_landing_leads_email ON landing_leads(email);
CREATE INDEX IF NOT EXISTS idx_landing_leads_created_at ON landing_leads(created_at DESC);

COMMIT;

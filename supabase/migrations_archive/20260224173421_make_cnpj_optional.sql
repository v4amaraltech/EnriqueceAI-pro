BEGIN;

-- Make CNPJ optional: remove NOT NULL and CHECK constraints
ALTER TABLE leads ALTER COLUMN cnpj DROP NOT NULL;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_cnpj_format;

-- Re-add CHECK only when cnpj is provided (nullable but must be valid if set)
ALTER TABLE leads ADD CONSTRAINT chk_leads_cnpj_format
  CHECK (cnpj IS NULL OR cnpj ~ '^\d{14}$');

-- Drop the old unique index (requires cnpj NOT NULL)
DROP INDEX IF EXISTS leads_org_id_cnpj_active_key;

-- Re-create partial unique index only for non-null cnpj
CREATE UNIQUE INDEX leads_org_id_cnpj_active_key
  ON leads (org_id, cnpj)
  WHERE deleted_at IS NULL AND cnpj IS NOT NULL;

COMMIT;

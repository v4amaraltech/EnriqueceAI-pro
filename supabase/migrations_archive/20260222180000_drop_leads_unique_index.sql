-- The constraint was dropped but the underlying unique index persisted.
-- Drop the index explicitly, then recreate as partial index.

DROP INDEX IF EXISTS leads_org_id_cnpj_key;
DROP INDEX IF EXISTS leads_org_id_cnpj_active_key;

CREATE UNIQUE INDEX leads_org_id_cnpj_active_key ON leads (org_id, cnpj) WHERE deleted_at IS NULL;

BEGIN;

-- Replace the full UNIQUE(org_id, cnpj) constraint with a partial unique index
-- that only enforces uniqueness on non-deleted leads.
-- This allows soft-deleted leads (deleted_at IS NOT NULL) to be reimported.

ALTER TABLE leads DROP CONSTRAINT leads_org_id_cnpj_key;

CREATE UNIQUE INDEX leads_org_id_cnpj_active_key ON leads (org_id, cnpj) WHERE deleted_at IS NULL;

COMMIT;

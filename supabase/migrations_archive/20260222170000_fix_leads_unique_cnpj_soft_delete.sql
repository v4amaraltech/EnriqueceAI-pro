-- Fix: the previous migration (20260222160000) was wrapped in BEGIN/COMMIT
-- which conflicted with Supabase's own transaction handling, so the
-- constraint was never actually dropped.

-- Drop the old full unique constraint (prevents reimporting soft-deleted leads)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_org_id_cnpj_key;

-- Drop partial index if it was somehow partially created
DROP INDEX IF EXISTS leads_org_id_cnpj_active_key;

-- Create partial unique index: only enforce uniqueness on active (non-deleted) leads
CREATE UNIQUE INDEX leads_org_id_cnpj_active_key ON leads (org_id, cnpj) WHERE deleted_at IS NULL;

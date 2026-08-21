-- The previous migration tried to add a covering index for the
-- leads_created_by_fkey foreign key, but an index with the same name
-- already existed with a composite definition (org_id, created_by) plus
-- WHERE filters, so the IF NOT EXISTS was a no-op and the linter still
-- flagged the FK as unindexed. This adds a single-column index that
-- Postgres can use to satisfy the FK lookup directly.

CREATE INDEX IF NOT EXISTS idx_leads_created_by_simple
ON public.leads (created_by)
WHERE created_by IS NOT NULL;

BEGIN;

-- Enforce email uniqueness per org for active (non-deleted) leads, mirroring the
-- existing partial unique index on (org_id, cnpj). Closes the email-duplication
-- bug at the database level: the inbound API deduped by email with a
-- check-then-insert, which races and also missed intra-batch repeats.
--
-- Case-insensitive (lower(email)) to match the API's case-insensitive dedup, and
-- partial so soft-deleted leads and null/empty emails never block inserts.
--
-- Prerequisite: existing duplicate active emails were merged/cleaned beforehand
-- (37 groups / 69 rows in production, June 2026). Creating this index will fail
-- if any active (org_id, lower(email)) duplicates remain.
CREATE UNIQUE INDEX IF NOT EXISTS leads_org_id_email_active_key
  ON leads (org_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '';

COMMIT;

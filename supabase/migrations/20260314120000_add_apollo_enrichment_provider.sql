BEGIN;

-- Add 'apollo' as a valid enrichment provider
ALTER TABLE enrichment_attempts
  DROP CONSTRAINT chk_enrichment_provider,
  ADD CONSTRAINT chk_enrichment_provider CHECK (provider IN ('cnpj_ws', 'lemit', 'apollo'));

COMMIT;

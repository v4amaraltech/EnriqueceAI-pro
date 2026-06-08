-- Auto-fill first_name + last_name + job_title from socios[0] when the lead
-- has no decisor recorded. Lemit enrichment fills socios with names+roles,
-- but until the SDR clicks into the lead nothing maps that to the decisor
-- columns the UI/cadence personalization actually reads.
--
-- 133 V4 Amaral leads currently have a populated socios[0] and NULL decisor.
--
-- Never-overwrite rule: trigger only fires when ALL three fields are NULL.
-- A CSV import or manual edit that filled any of them keeps priority — the
-- SDR's choice always wins.

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_fill_decisor_from_socios()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_nome           TEXT;
  v_qualificacao   TEXT;
  v_space_pos      INT;
BEGIN
  -- Never overwrite manual / imported data.
  IF NEW.first_name IS NOT NULL
     OR NEW.last_name IS NOT NULL
     OR NEW.job_title IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.socios IS NULL OR jsonb_array_length(NEW.socios) = 0 THEN
    RETURN NEW;
  END IF;

  v_nome := trim(NEW.socios -> 0 ->> 'nome');
  v_qualificacao := trim(NEW.socios -> 0 ->> 'qualificacao');

  IF v_nome IS NULL OR v_nome = '' THEN
    RETURN NEW;
  END IF;

  -- Split on the first space: everything before is first_name, everything
  -- after is last_name. Single-word names land in first_name with last_name
  -- staying NULL.
  v_space_pos := position(' ' in v_nome);
  IF v_space_pos > 0 THEN
    NEW.first_name := substring(v_nome from 1 for v_space_pos - 1);
    NEW.last_name := substring(v_nome from v_space_pos + 1);
  ELSE
    NEW.first_name := v_nome;
  END IF;

  IF v_qualificacao IS NOT NULL AND v_qualificacao <> '' THEN
    NEW.job_title := v_qualificacao;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_fill_decisor_trigger ON leads;

CREATE TRIGGER auto_fill_decisor_trigger
  BEFORE INSERT OR UPDATE OF socios, first_name, last_name, job_title ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_decisor_from_socios();

-- Backfill: explicit UPDATE rather than touching socios so the change
-- materializes even when Postgres skips the BEFORE-UPDATE-OF trigger on
-- an unchanged socios value.
UPDATE leads
SET
  first_name = split_part(trim(socios -> 0 ->> 'nome'), ' ', 1),
  last_name = CASE
    WHEN position(' ' in trim(socios -> 0 ->> 'nome')) > 0
    THEN substring(trim(socios -> 0 ->> 'nome') from position(' ' in trim(socios -> 0 ->> 'nome')) + 1)
    ELSE NULL
  END,
  job_title = CASE
    WHEN trim(socios -> 0 ->> 'qualificacao') = '' THEN NULL
    ELSE trim(socios -> 0 ->> 'qualificacao')
  END
WHERE deleted_at IS NULL
  AND first_name IS NULL
  AND last_name IS NULL
  AND job_title IS NULL
  AND socios IS NOT NULL
  AND jsonb_array_length(socios) > 0
  AND trim(socios -> 0 ->> 'nome') IS NOT NULL
  AND trim(socios -> 0 ->> 'nome') <> '';

COMMIT;

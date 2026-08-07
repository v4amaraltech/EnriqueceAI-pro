-- Auto-fill the Tier custom_field from the Faturamento Broker custom_field on
-- every INSERT/UPDATE of leads. Setup (system_key markers + currency field type)
-- already applied in 20260512200000 and 20260512210000.
--
-- Ranges (in reais, inclusive lower bound except Não ICP):
--   Não ICP     <= R$ 50.000
--   Tiny        R$ 50.000,01 – R$ 100.000
--   Small       R$ 100.000,01 – R$ 200.000
--   Medium      R$ 200.000,01 – R$ 4.000.000
--   Large       R$ 4.000.000,01 – R$ 40.000.000
--   Enterprise  > R$ 40.000.000
--
-- Storage note: CurrencyInput.tsx saves the value as a digit-only string of
-- CENTAVOS (e.g. R$ 1.500.000,00 → "150000000"). Some legacy paths may have
-- stored reais with a decimal point ("1500000.00"). The trigger normalizes
-- both forms before applying the ranges.

BEGIN;

-- 1. Pure mapping function. Takes faturamento in REAIS, returns tier label.
CREATE OR REPLACE FUNCTION public.calculate_tier_from_faturamento(faturamento_reais NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF faturamento_reais IS NULL THEN
    RETURN NULL;
  END IF;
  IF faturamento_reais <= 50000     THEN RETURN 'Não ICP';    END IF;
  IF faturamento_reais <= 100000    THEN RETURN 'Tiny';       END IF;
  IF faturamento_reais <= 200000    THEN RETURN 'Small';      END IF;
  IF faturamento_reais <= 4000000   THEN RETURN 'Medium';     END IF;
  IF faturamento_reais <= 40000000  THEN RETURN 'Large';      END IF;
  RETURN 'Enterprise';
END;
$$;

COMMENT ON FUNCTION public.calculate_tier_from_faturamento(NUMERIC) IS
  'Maps annual revenue in reais to the V4 tier label. Used by set_tier_from_broker trigger.';

-- 2. Trigger function. Reads tier_input custom_field value from NEW row,
-- normalizes from centavos (UI default) or legacy reais-with-dot, looks up
-- the tier, and writes it back into tier_output. Runs BEFORE so the write
-- happens in the same physical row update — no recursion possible.
CREATE OR REPLACE FUNCTION public.set_tier_from_broker()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_input_id        UUID;
  v_output_id       UUID;
  v_broker_str      TEXT;
  v_old_broker_str  TEXT;
  v_broker_reais    NUMERIC;
  v_new_tier        TEXT;
BEGIN
  -- Resolve field IDs for this org. Skip silently if the org hasn't opted in.
  SELECT id INTO v_input_id
  FROM custom_fields
  WHERE org_id = NEW.org_id AND system_key = 'tier_input';

  IF v_input_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_output_id
  FROM custom_fields
  WHERE org_id = NEW.org_id AND system_key = 'tier_output';

  IF v_output_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_broker_str := NEW.custom_field_values ->> v_input_id::text;

  -- On UPDATE, short-circuit when broker hasn't changed. Without this every
  -- write to custom_field_values (notes, other fields) would re-run the
  -- mapping needlessly.
  IF TG_OP = 'UPDATE' THEN
    v_old_broker_str := OLD.custom_field_values ->> v_input_id::text;
    IF v_broker_str IS NOT DISTINCT FROM v_old_broker_str THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Empty broker → leave tier alone (don't overwrite manually-set tier with NULL).
  IF v_broker_str IS NULL OR v_broker_str = '' THEN
    RETURN NEW;
  END IF;

  -- Parse: digits-only is centavos, presence of "." is legacy reais.
  BEGIN
    IF position('.' in v_broker_str) > 0 THEN
      v_broker_reais := v_broker_str::NUMERIC;
    ELSE
      v_broker_reais := v_broker_str::NUMERIC / 100;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Unparseable value (shouldn't happen with currency field_type) — bail.
    RETURN NEW;
  END;

  v_new_tier := calculate_tier_from_faturamento(v_broker_reais);

  IF v_new_tier IS NOT NULL THEN
    NEW.custom_field_values := jsonb_set(
      COALESCE(NEW.custom_field_values, '{}'::jsonb),
      ARRAY[v_output_id::text],
      to_jsonb(v_new_tier),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_tier_from_broker() IS
  'BEFORE INSERT/UPDATE trigger on leads. Auto-fills tier_output custom_field whenever tier_input (Faturamento Broker) changes. No-op for orgs that haven''t marked the system_keys.';

-- 3. Trigger. UPDATE OF custom_field_values keeps the trigger from firing on
-- unrelated lead updates (status changes, notes, etc.) — Postgres only runs
-- it when that specific column appears in the SET list.
DROP TRIGGER IF EXISTS set_tier_from_broker_trigger ON leads;

CREATE TRIGGER set_tier_from_broker_trigger
  BEFORE INSERT OR UPDATE OF custom_field_values ON leads
  FOR EACH ROW
  EXECUTE FUNCTION set_tier_from_broker();

-- 4. Lock down to authenticated/service_role like the other definer fns
-- protected in 20260512180000. calculate_tier_from_faturamento is SECURITY
-- INVOKER (default) so no special revoke needed, but be explicit.
REVOKE EXECUTE ON FUNCTION public.calculate_tier_from_faturamento(NUMERIC) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_tier_from_broker() FROM anon, PUBLIC;

COMMIT;

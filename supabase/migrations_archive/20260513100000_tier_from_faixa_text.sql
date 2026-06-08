-- Reality check on production data: Faturamento Broker is being populated
-- with descriptive ranges in Portuguese — "De 51 mil à 70 mil", "De 201 mil
-- à 400 mil", "Mais de 40 milhões", etc — not numeric values. 316 V4 Amaral
-- leads have already landed with this shape and the auto-tier trigger from
-- 20260512220000 silently bails on every one of them (text::NUMERIC throws,
-- exception swallows it, tier stays NULL).
--
-- Original assumption ("Broker is a currency input") was wrong: the source
-- pipeline (Lemit / data broker / n8n) emits text categories. Revert the
-- field_type to `text`, teach the trigger to recognize the Portuguese range
-- patterns, keep the numeric branch as fallback so manual edits via a future
-- numeric input still work.

BEGIN;

-- 1. Roll field_type back to 'text'. Currency was a wrong guess; the source
-- system feeds free-text labels.
UPDATE custom_fields
SET field_type = 'text'
WHERE system_key = 'tier_input'
  AND field_type <> 'text';

-- 2. New helper: takes a Portuguese range label and returns the V4 tier.
-- Strategy: extract the largest number from the string, multiply by the
-- recognized unit (mil = 1k, milh = 1M; check milh first because milhão
-- contains "mil"), then dispatch to calculate_tier_from_faturamento. When
-- the label uses "Mais de"/"Acima de", bump the value by 1 so the open
-- interval lands on the next tier (40M → Enterprise, not Large).
CREATE OR REPLACE FUNCTION public.calculate_tier_from_faixa(faixa_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_norm        TEXT;
  v_numbers     TEXT[];
  v_max_reais   NUMERIC;
  v_open_ended  BOOLEAN := false;
BEGIN
  IF faixa_input IS NULL OR trim(faixa_input) = '' THEN
    RETURN NULL;
  END IF;

  v_norm := lower(faixa_input);

  IF v_norm ~ '(mais de|acima de)' THEN
    v_open_ended := true;
  END IF;

  -- All integer tokens, in order. Last one is the upper bound of the range.
  SELECT array_agg(m[1] ORDER BY ord) INTO v_numbers
  FROM regexp_matches(v_norm, '\d+', 'g') WITH ORDINALITY AS t(m, ord);

  IF v_numbers IS NULL OR array_length(v_numbers, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  v_max_reais := v_numbers[array_length(v_numbers, 1)]::NUMERIC;

  -- Unit multiplier. "milh" must be tested first — milhão/milhões both
  -- match "mil" too.
  IF v_norm ~ 'milh' THEN
    v_max_reais := v_max_reais * 1000000;
  ELSIF v_norm ~ 'mil' THEN
    v_max_reais := v_max_reais * 1000;
  END IF;

  IF v_open_ended THEN
    v_max_reais := v_max_reais + 1; -- "Mais de 40 milhões" → 40_000_001 → Enterprise
  END IF;

  RETURN calculate_tier_from_faturamento(v_max_reais);
END;
$$;

COMMENT ON FUNCTION public.calculate_tier_from_faixa(TEXT) IS
  'Maps a Portuguese revenue-range label (e.g. "De 201 mil à 400 mil", "Mais de 40 milhões") to a V4 tier. Used by set_tier_from_broker when the broker column carries text instead of a number.';

REVOKE EXECUTE ON FUNCTION public.calculate_tier_from_faixa(TEXT) FROM anon, authenticated, PUBLIC;

-- 3. Update the trigger function to route by content: any letter → text
-- parser, otherwise the existing numeric path (centavos vs reais-with-dot).
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

  IF TG_OP = 'UPDATE' THEN
    v_old_broker_str := OLD.custom_field_values ->> v_input_id::text;
    IF v_broker_str IS NOT DISTINCT FROM v_old_broker_str THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_broker_str IS NULL OR v_broker_str = '' THEN
    RETURN NEW;
  END IF;

  -- Letter detected → treat as a Portuguese range label.
  -- No letters → assume numeric (centavos from CurrencyInput or legacy
  -- reais-with-dot).
  IF v_broker_str ~ '[a-zA-Z]' THEN
    v_new_tier := calculate_tier_from_faixa(v_broker_str);
  ELSE
    BEGIN
      IF position('.' in v_broker_str) > 0 THEN
        v_broker_reais := v_broker_str::NUMERIC;
      ELSE
        v_broker_reais := v_broker_str::NUMERIC / 100;
      END IF;
      v_new_tier := calculate_tier_from_faturamento(v_broker_reais);
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;
  END IF;

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

-- 4. Backfill — recalculate tier on every V4 Amaral lead that already
-- carries a broker label. Direct UPDATE bypasses the trigger's
-- short-circuit by writing the new tier explicitly; if the trigger then
-- re-fires it's idempotent (broker hasn't changed, exits early).
UPDATE leads
SET custom_field_values = jsonb_set(
  custom_field_values,
  ARRAY[(SELECT id::text FROM custom_fields WHERE org_id = leads.org_id AND system_key = 'tier_output')],
  to_jsonb(calculate_tier_from_faixa(
    custom_field_values ->> (SELECT id::text FROM custom_fields WHERE org_id = leads.org_id AND system_key = 'tier_input')
  )),
  true
)
WHERE org_id IN (SELECT org_id FROM custom_fields WHERE system_key = 'tier_input')
  AND deleted_at IS NULL
  AND custom_field_values ? (SELECT id::text FROM custom_fields WHERE org_id = leads.org_id AND system_key = 'tier_input')
  AND calculate_tier_from_faixa(
        custom_field_values ->> (SELECT id::text FROM custom_fields WHERE org_id = leads.org_id AND system_key = 'tier_input')
      ) IS NOT NULL;

COMMIT;

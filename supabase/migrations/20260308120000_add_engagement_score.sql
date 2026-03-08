BEGIN;

-- 1. Add engagement_score column to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS engagement_score SMALLINT DEFAULT NULL;

COMMENT ON COLUMN leads.engagement_score IS 'Engagement temperature 0-100, computed from interactions with time decay. NULL = no interactions.';

-- 2. Index for sorting/filtering by engagement_score
CREATE INDEX IF NOT EXISTS idx_leads_engagement_score
  ON leads(org_id, engagement_score DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- 3. Compute function: calculates engagement score from interactions with time decay
CREATE OR REPLACE FUNCTION calculate_engagement_score(p_lead_id UUID)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_score NUMERIC := 0;
  v_weight NUMERIC;
  v_decay NUMERIC;
  v_days NUMERIC;
  v_has_interactions BOOLEAN := FALSE;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT type, created_at
    FROM interactions
    WHERE lead_id = p_lead_id
      AND created_at > now() - interval '90 days'
  LOOP
    v_has_interactions := TRUE;

    -- Base weight per interaction type
    v_weight := CASE rec.type
      WHEN 'sent' THEN 2
      WHEN 'delivered' THEN 3
      WHEN 'opened' THEN 5
      WHEN 'clicked' THEN 8
      WHEN 'replied' THEN 20
      WHEN 'meeting_scheduled' THEN 30
      WHEN 'bounced' THEN -10
      WHEN 'failed' THEN -5
      ELSE 0
    END;

    -- Time decay: max(0.1, 1 - days_since / 90)
    v_days := EXTRACT(EPOCH FROM (now() - rec.created_at)) / 86400.0;
    v_decay := GREATEST(0.1, 1.0 - (v_days / 90.0));

    v_score := v_score + (v_weight * v_decay);
  END LOOP;

  -- NULL if no interactions in the last 90 days
  IF NOT v_has_interactions THEN
    -- Check if there are ANY interactions (older than 90 days)
    IF NOT EXISTS (SELECT 1 FROM interactions WHERE lead_id = p_lead_id LIMIT 1) THEN
      RETURN NULL;
    END IF;
    -- Has old interactions but none recent → score 0
    RETURN 0;
  END IF;

  -- Clamp 0-100
  RETURN LEAST(100, GREATEST(0, ROUND(v_score)))::SMALLINT;
END;
$$;

-- 4. Recalc wrapper that updates the leads row (SECURITY DEFINER to bypass RLS from trigger context)
CREATE OR REPLACE FUNCTION recalc_engagement_score(p_lead_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE leads
  SET engagement_score = calculate_engagement_score(p_lead_id),
      updated_at = now()
  WHERE id = p_lead_id;
END;
$$;

-- 5. Trigger function: recalc on every interaction insert
CREATE OR REPLACE FUNCTION trigger_recalc_engagement_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM recalc_engagement_score(NEW.lead_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalc_engagement_on_interaction ON interactions;
CREATE TRIGGER recalc_engagement_on_interaction
  AFTER INSERT ON interactions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_engagement_score();

COMMIT;

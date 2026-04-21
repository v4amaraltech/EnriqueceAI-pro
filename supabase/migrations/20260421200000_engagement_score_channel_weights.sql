BEGIN;

-- Update engagement score calculation to consider channel-specific weights.
-- Phone calls, WhatsApp, and LinkedIn now have distinct weights from email.
-- System events (automated) no longer inflate engagement.
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
    SELECT type, channel, created_at
    FROM interactions
    WHERE lead_id = p_lead_id
      AND created_at > now() - interval '90 days'
  LOOP
    v_has_interactions := TRUE;

    -- Base weight per interaction type + channel-specific overrides
    v_weight := CASE
      -- 'sent' type: weight depends on channel
      WHEN rec.type = 'sent' AND rec.channel = 'phone' THEN 5
      WHEN rec.type = 'sent' AND rec.channel = 'whatsapp' THEN 4
      WHEN rec.type = 'sent' AND rec.channel = 'linkedin' THEN 3
      WHEN rec.type = 'sent' AND rec.channel = 'email' THEN 2
      WHEN rec.type = 'sent' AND rec.channel = 'research' THEN 1
      WHEN rec.type = 'sent' AND rec.channel = 'system' THEN 0
      WHEN rec.type = 'sent' THEN 2 -- fallback for unknown channels

      -- 'replied' type: channel-specific
      WHEN rec.type = 'replied' AND rec.channel = 'whatsapp' THEN 20
      WHEN rec.type = 'replied' THEN 25

      -- 'failed' type: channel-specific
      WHEN rec.type = 'failed' AND rec.channel = 'whatsapp' THEN -3
      WHEN rec.type = 'failed' THEN -5

      -- Standard types (no channel override)
      WHEN rec.type = 'delivered' THEN 3
      WHEN rec.type = 'opened' THEN 5
      WHEN rec.type = 'clicked' THEN 10
      WHEN rec.type = 'meeting_scheduled' THEN 30
      WHEN rec.type = 'bounced' THEN -10
      ELSE 0
    END;

    -- Time decay: max(0.1, 1 - days_since / 90)
    v_days := EXTRACT(EPOCH FROM (now() - rec.created_at)) / 86400.0;
    v_decay := GREATEST(0.1, 1.0 - (v_days / 90.0));

    v_score := v_score + (v_weight * v_decay);
  END LOOP;

  -- NULL if no interactions in the last 90 days
  IF NOT v_has_interactions THEN
    IF NOT EXISTS (SELECT 1 FROM interactions WHERE lead_id = p_lead_id LIMIT 1) THEN
      RETURN NULL;
    END IF;
    RETURN 0;
  END IF;

  -- Clamp 0-100
  RETURN LEAST(100, GREATEST(0, ROUND(v_score)))::SMALLINT;
END;
$$;

COMMENT ON FUNCTION calculate_engagement_score(UUID) IS
  'Calculates lead engagement score (0-100) with channel-specific weights. '
  'Phone=5, WhatsApp=4, LinkedIn=3, Email=2, Research=1, System=0 for sent type. '
  'Time decay over 90 days.';

COMMIT;

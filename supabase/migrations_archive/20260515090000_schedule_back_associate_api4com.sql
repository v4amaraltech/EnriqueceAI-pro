-- Back-association worker /api/workers/back-associate-api4com-webhooks
-- correlates webhook channel-hangup events against local calls that
-- never received the id-based match (because POST /dialer returns a
-- different id than the channel-hangup payload — see
-- 2b5ed08 / d831b08 for the diagnostic).
--
-- Every 30 min is enough: the in-handler fallback (origin+destination
-- within 2h) already catches most events when they arrive; this worker
-- mops up the cases where the call_record was created seconds after
-- the webhook fired, or the handler fallback couldn't find the row.

BEGIN;

DO $$
DECLARE
  template_command TEXT;
  new_command TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'back-associate-api4com-webhooks') THEN
    RAISE NOTICE 'back-associate-api4com-webhooks already scheduled, skipping';
    RETURN;
  END IF;

  SELECT command INTO template_command
  FROM cron.job
  WHERE jobname = 'daily-cadence-summary'
  LIMIT 1;

  IF template_command IS NULL THEN
    RAISE EXCEPTION 'Template cron daily-cadence-summary not found — cannot derive header';
  END IF;

  new_command := replace(
    template_command,
    'https://app.enriqueceai.com.br/api/cron/daily-cadence-summary',
    'https://app.enriqueceai.com.br/api/workers/back-associate-api4com-webhooks'
  );

  PERFORM cron.schedule('back-associate-api4com-webhooks', '*/30 * * * *', new_command);
END;
$$;

COMMIT;

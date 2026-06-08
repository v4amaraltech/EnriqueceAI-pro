BEGIN;

-- Move scheduled_activities from pending to expired once they are 3 days past
-- their scheduled time. The 'expired' status was added in
-- 20260510013355_scheduled_activities_expired_status but no automated
-- transition existed, so 6 rows from mid-April were still stuck in 'pending'.
-- Running daily at 04h UTC (01h BRT) so the queue is clean by morning.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-old-pending-activities') THEN
    PERFORM cron.unschedule('expire-old-pending-activities');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-old-pending-activities',
  '0 4 * * *',
  $$
  UPDATE scheduled_activities
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending'
    AND scheduled_at < now() - interval '3 days';
  $$
);

COMMIT;

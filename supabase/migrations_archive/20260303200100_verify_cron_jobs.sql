-- Verify cron jobs are scheduled (this is a no-op check migration)
DO $$
DECLARE
  job_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO job_count FROM cron.job WHERE jobname IN ('execute-cadence-steps', 'check-email-replies');
  IF job_count < 2 THEN
    RAISE EXCEPTION 'Expected 2 cron jobs, found %', job_count;
  END IF;
  RAISE NOTICE 'pg_cron verification: % jobs active', job_count;
END $$;

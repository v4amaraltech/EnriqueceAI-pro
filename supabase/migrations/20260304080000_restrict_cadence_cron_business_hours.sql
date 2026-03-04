BEGIN;

-- Restrict cadence execution to business hours only (8h-18h BRT, Mon-Fri)
-- BRT = UTC-3, so 8h BRT = 11h UTC, 18h BRT = 21h UTC
-- Hour range 11-20 UTC = 8:00-17:55 BRT (last run at 17:55)
-- Day-of-week 1-5 = Monday-Friday

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'execute-cadence-steps';

SELECT cron.schedule(
  'execute-cadence-steps',
  '*/5 11-20 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://app.enriqueceai.com.br/api/cron/execute-cadence-steps',
    headers := '{"Authorization": "Bearer 1de7732d2ecb012aa05e37a31b81758ae79f82f422367aab9c18f1e273ad6a9a", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Note: check-email-replies keeps running 24/7 (reading replies, not sending)

COMMIT;

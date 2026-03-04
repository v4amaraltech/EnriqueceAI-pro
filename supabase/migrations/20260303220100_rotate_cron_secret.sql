-- Rotate CRON_SECRET in pg_cron jobs
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('execute-cadence-steps', 'check-email-replies');

-- Execute cadence steps every 5 minutes
SELECT cron.schedule(
  'execute-cadence-steps',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.enriqueceai.com.br/api/cron/execute-cadence-steps',
    headers := '{"Authorization": "Bearer 1de7732d2ecb012aa05e37a31b81758ae79f82f422367aab9c18f1e273ad6a9a", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Check email replies every 10 minutes
SELECT cron.schedule(
  'check-email-replies',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.enriqueceai.com.br/api/cron/check-email-replies',
    headers := '{"Authorization": "Bearer 1de7732d2ecb012aa05e37a31b81758ae79f82f422367aab9c18f1e273ad6a9a", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

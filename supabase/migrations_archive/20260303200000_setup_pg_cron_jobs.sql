-- Enable pg_net extension (for HTTP calls from pg_cron)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remove existing jobs if any
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('execute-cadence-steps', 'check-email-replies');

-- Execute cadence steps every 5 minutes
SELECT cron.schedule(
  'execute-cadence-steps',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.enriqueceai.com.br/api/cron/execute-cadence-steps',
    headers := '{"Authorization": "Bearer 6e8c269178598fedeae8339355810fa559ee956db6c1e054feef452a062e733f", "Content-Type": "application/json"}'::jsonb,
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
    headers := '{"Authorization": "Bearer 6e8c269178598fedeae8339355810fa559ee956db6c1e054feef452a062e733f", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

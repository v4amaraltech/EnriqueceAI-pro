BEGIN;

-- Daily cadence summary email — runs at 18:00 BRT (21:00 UTC) on weekdays
SELECT cron.schedule(
  'daily-cadence-summary',
  '0 21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://app.enriqueceai.com.br/api/cron/daily-cadence-summary',
    headers := '{"Authorization": "Bearer 1de7732d2ecb012aa05e37a31b81758ae79f82f422367aab9c18f1e273ad6a9a", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

COMMIT;

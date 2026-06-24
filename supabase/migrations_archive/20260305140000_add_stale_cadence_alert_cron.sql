BEGIN;

-- Cron job: Alerta de cadência sem atividade (9h BRT = 12h UTC, seg-sex)
SELECT cron.schedule(
  'stale-cadence-alert',
  '0 12 * * 1-5',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.app_url') || '/api/cron/stale-cadence-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMIT;

-- BDR-5 — saúde das caixas do BDR (bounce > 5% em 100 envios pausa só a caixa), diário 7h BRT
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bdr-mailbox-health') THEN
    PERFORM cron.unschedule('bdr-mailbox-health');
  END IF;
  PERFORM cron.schedule(
    'bdr-mailbox-health',
    '0 10 * * 1-5',
    $cron$
    SELECT net.http_post(
      url := 'https://app.enriqueceai.com.br/api/cron/bdr-mailbox-health',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;
COMMIT;

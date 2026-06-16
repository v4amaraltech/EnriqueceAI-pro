BEGIN;

-- Agenda o cron "reunião sem desfecho" (meeting-outcome-check).
--
-- Roda 08h BRT (11h UTC) seg-sex e chama o endpoint Next, que varre
-- find_meetings_pending_outcome() e age em 2 estágios (checkpoint +24h,
-- escalação +2 dias úteis). O cálculo fino de janela/dia útil mora no endpoint.
--
-- Segue o MESMO padrão dos ~12 outros crons do sistema (ver
-- 20260511180000_fix_cron_jobs_url_pattern.sql): URL hardcoded + Bearer via
-- current_setting('app.settings.cron_secret', true). O token NÃO entra no git
-- (placeholder 'REPLACE_ME'); produção mantém o token vigente aplicado
-- out-of-band (cron.schedule via MCP com o segredo real, igual aos demais).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-outcome-check') THEN
    PERFORM cron.unschedule('meeting-outcome-check');
  END IF;

  PERFORM cron.schedule(
    'meeting-outcome-check',
    '0 11 * * 1-5',
    $cron$
    SELECT net.http_post(
      url := 'https://app.enriqueceai.com.br/api/cron/meeting-outcome-check',
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

BEGIN;

-- Schedule check-email-replies every 15 minutes
SELECT cron.schedule('check-email-replies', '*/15 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-email-replies',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb
  ) $$
);

COMMIT;

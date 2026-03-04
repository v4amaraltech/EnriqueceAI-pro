-- Schedule evolution-cleanup edge function to run every 30 minutes
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'evolution-cleanup';

SELECT cron.schedule(
  'evolution-cleanup',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dhkmonctyoaenejemkrt.supabase.co/functions/v1/evolution-cleanup',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoa21vbmN0eW9hZW5lamVta3J0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxNjI3MDQsImV4cCI6MjA3MjczODcwNH0.auu515d8lTo1aWYHYPYGR6ICol_D-skRX7yclHZHY4g", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

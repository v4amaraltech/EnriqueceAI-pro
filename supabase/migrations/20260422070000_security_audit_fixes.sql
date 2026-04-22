BEGIN;

-- D3: Fix get_calls_for_v4sales(text) — was returning calls from ALL orgs
-- Now scoped to the V4 Sales org only
CREATE OR REPLACE FUNCTION public.get_calls_for_v4sales(p_from_date text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_from timestamptz;
    v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
BEGIN
    v_from := COALESCE(p_from_date::timestamptz, date_trunc('month', CURRENT_DATE));

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
        FROM (
            SELECT
                id,
                user_id,
                origin,
                destination,
                started_at,
                duration_seconds,
                status,
                type,
                recording_url,
                transcription,
                metadata
            FROM public.calls
            WHERE org_id = v_org_id
              AND started_at >= v_from
            ORDER BY started_at DESC
            LIMIT 500
        ) c
    );
END;
$function$;

-- D4: Improved cleanup — trim old payloads + delete very old rows
CREATE OR REPLACE FUNCTION public.cleanup_provider_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Delete events older than 7 days
  DELETE FROM provider_events WHERE processed_at < now() - interval '7 days';

  -- Trim payloads older than 1 day (keep only essential metadata)
  UPDATE provider_events
  SET payload = jsonb_build_object(
    'event_type', payload->>'event_type',
    'instance', payload->>'instance',
    'trimmed', true
  )
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - interval '1 day'
    AND (payload->>'trimmed') IS DISTINCT FROM 'true';
END;
$function$;

COMMIT;

-- PARTIAL EXACT PRODUCTION DRIFT BASELINE; NOT A COMPLETE FRESH-RESET FIX.

-- Historical LDR tables/views/functions and calls_dedupe_backup_20260517 no longer exist

-- in production. Do not invent their structure; guard obsolete references separately.

-- No production data or secrets are included. Only catalog-derived structure.

DO $baseline$ BEGIN

  IF NOT EXISTS (SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='closer_qualificacao_aderencia') THEN

    CREATE TYPE public.closer_qualificacao_aderencia AS ENUM ('bateu', 'divergiu', 'nao_validado');

  END IF;

END $baseline$;

ALTER TABLE public."leads" ADD COLUMN IF NOT EXISTS "segmento" text;

ALTER TABLE public."leads" ADD COLUMN IF NOT EXISTS "whatsapp_abordado_at" timestamp with time zone;

ALTER TABLE public."leads" ADD COLUMN IF NOT EXISTS "callface_enviado_at" timestamp with time zone;

-- lost_at também é criada por 20260407080000 (IF NOT EXISTS); necessária aqui para idx_leads_callface_pendente
ALTER TABLE public."leads" ADD COLUMN IF NOT EXISTS "lost_at" timestamp with time zone;

ALTER TABLE public."gmail_connections" ADD COLUMN IF NOT EXISTS "cached_signature" text;

ALTER TABLE public."gmail_connections" ADD COLUMN IF NOT EXISTS "signature_cached_at" timestamp with time zone;

ALTER TABLE public."closers" ADD COLUMN IF NOT EXISTS "phone" text;

ALTER TABLE public."goals" ADD COLUMN IF NOT EXISTS "leads_finished_target" integer DEFAULT 0;

ALTER TABLE public."closer_feedback_requests" ADD COLUMN IF NOT EXISTS "qualificacao_aderente" public.closer_qualificacao_aderencia;

ALTER TABLE public."closer_feedback_requests" ADD COLUMN IF NOT EXISTS "divergencias" text[];

DO $baseline$ BEGIN IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.closer_feedback_requests'::regclass AND conname='closer_feedback_divergencias_obrigatorias') THEN

ALTER TABLE public.closer_feedback_requests ADD CONSTRAINT closer_feedback_divergencias_obrigatorias CHECK (((qualificacao_aderente IS DISTINCT FROM 'divergiu'::closer_qualificacao_aderencia) OR (COALESCE(array_length(divergencias, 1), 0) >= 1)));

END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.closer_feedback_requests'::regclass AND conname='closer_feedback_divergencias_somente_se_divergiu') THEN

ALTER TABLE public.closer_feedback_requests ADD CONSTRAINT closer_feedback_divergencias_somente_se_divergiu CHECK (((qualificacao_aderente = 'divergiu'::closer_qualificacao_aderencia) OR (COALESCE(array_length(divergencias, 1), 0) = 0)));

END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.closer_feedback_requests'::regclass AND conname='closer_feedback_divergencias_validas') THEN

ALTER TABLE public.closer_feedback_requests ADD CONSTRAINT closer_feedback_divergencias_validas CHECK (((divergencias IS NULL) OR (divergencias <@ ARRAY['verba'::text, 'decisor'::text, 'dor'::text, 'timing'::text, 'dados_cadastrais'::text])));

END IF; END $baseline$;

CREATE INDEX IF NOT EXISTS idx_closer_feedback_qualificacao ON public.closer_feedback_requests USING btree (qualificacao_aderente) WHERE (responded_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_leads_callface_pendente ON public.leads USING btree (lost_at) WHERE ((status = 'unqualified'::lead_status) AND (deleted_at IS NULL) AND (callface_enviado_at IS NULL));

CREATE OR REPLACE FUNCTION public.auto_enroll_ldr_autonomo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cadence_id uuid := '896ce318-1c1a-4c3f-8f55-5646404f1023';
  v_already_enrolled boolean;
BEGIN
  -- Só enrolla se o lead_source for do LDR Autônomo
  IF NEW.lead_source = 'LDR Autonomo IA' THEN
    
    -- Verifica se já não está enrollado nessa cadência
    SELECT EXISTS(
      SELECT 1 FROM public.cadence_enrollments 
      WHERE lead_id = NEW.id 
        AND cadence_id = v_cadence_id
        AND status = 'active'
    ) INTO v_already_enrolled;
    
    -- Se não está enrollado, cria o enrollment
    IF NOT v_already_enrolled THEN
      INSERT INTO public.cadence_enrollments (
        cadence_id,
        lead_id,
        current_step,
        status,
        next_step_due,
        org_id
      ) VALUES (
        v_cadence_id,
        NEW.id,
        1,
        'active',
        NOW(),
        NEW.org_id
      );
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.auto_enroll_ldr_autonomo() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.auto_enroll_ldr_autonomo() TO service_role;

CREATE OR REPLACE FUNCTION public.get_calls_for_v4sales(p_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer, p_month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_metrics jsonb; v_calls jsonb;
BEGIN
    v_start := DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1))::TIMESTAMPTZ;
    v_end := (DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1)) + INTERVAL '1 month')::TIMESTAMPTZ;
    SELECT jsonb_agg(row_to_json(t)) INTO v_metrics FROM (
        SELECT c.user_id::text AS enriquece_user_id, au.email,
            COUNT(*) AS ligacoes_realizadas,
            COUNT(*) FILTER (
                WHERE COALESCE(c.sdr_disposition::text,'') <> 'voicemail'
                  AND c.answered_at IS NOT NULL AND c.duration_seconds >= 50
            ) AS ligacoes_conectadas,
            ROUND(COUNT(*) FILTER (
                WHERE COALESCE(c.sdr_disposition::text,'') <> 'voicemail'
                  AND c.answered_at IS NOT NULL AND c.duration_seconds >= 50
            )::numeric / NULLIF(COUNT(*),0), 4) AS pct_conectadas
        FROM calls c JOIN auth.users au ON au.id = c.user_id
        WHERE c.started_at >= v_start AND c.started_at < v_end AND c.type = 'outbound'
        GROUP BY c.user_id, au.email
    ) t;
    SELECT jsonb_agg(row_to_json(t)) INTO v_calls FROM (
        SELECT c.id::text AS enriquece_call_id, c.user_id::text AS enriquece_user_id, au.email,
            c.origin, c.destination, c.started_at, c.duration_seconds, c.status::text, c.type::text,
            c.recording_url, c.transcription, c.transcription_status, c.answered_at,
            c.hangup_cause, c.sdr_disposition::text
        FROM calls c JOIN auth.users au ON au.id = c.user_id
        WHERE c.started_at >= v_start AND c.started_at < v_end AND c.type = 'outbound'
    ) t;
    RETURN jsonb_build_object('year', p_year, 'month', p_month,
        'metrics', COALESCE(v_metrics, '[]'::jsonb), 'calls', COALESCE(v_calls, '[]'::jsonb));
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_calls_for_v4sales(integer,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_calls_for_v4sales(integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_calls_for_v4sales(p_from_date text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_from timestamptz;
    v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
BEGIN
    v_from := COALESCE(p_from_date::timestamptz, date_trunc('month', CURRENT_DATE));
    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
        FROM (
            SELECT id, user_id, origin, destination, started_at, duration_seconds,
                   status, type, recording_url, transcription, metadata,
                   answered_at, hangup_cause, sdr_disposition
            FROM public.calls
            WHERE org_id = v_org_id AND started_at >= v_from
            ORDER BY started_at DESC
            LIMIT p_limit
        ) c
    );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_calls_for_v4sales(text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_calls_for_v4sales(text,integer) TO service_role;

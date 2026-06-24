

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."cadence_status" AS ENUM (
    'draft',
    'active',
    'paused',
    'archived'
);


ALTER TYPE "public"."cadence_status" OWNER TO "postgres";


CREATE TYPE "public"."call_status" AS ENUM (
    'significant',
    'not_significant',
    'no_contact',
    'busy',
    'not_connected'
);


ALTER TYPE "public"."call_status" OWNER TO "postgres";


CREATE TYPE "public"."call_type" AS ENUM (
    'inbound',
    'outbound',
    'manual'
);


ALTER TYPE "public"."call_type" OWNER TO "postgres";


CREATE TYPE "public"."channel_type" AS ENUM (
    'email',
    'whatsapp',
    'phone',
    'linkedin',
    'research',
    'calendar',
    'system',
    'crm'
);


ALTER TYPE "public"."channel_type" OWNER TO "postgres";


CREATE TYPE "public"."closer_feedback_result" AS ENUM (
    'meeting_done',
    'no_show',
    'rescheduled'
);


ALTER TYPE "public"."closer_feedback_result" OWNER TO "postgres";


CREATE TYPE "public"."connection_status" AS ENUM (
    'connected',
    'disconnected',
    'error',
    'syncing'
);


ALTER TYPE "public"."connection_status" OWNER TO "postgres";


CREATE TYPE "public"."crm_type" AS ENUM (
    'hubspot',
    'pipedrive',
    'rdstation',
    'kommo'
);


ALTER TYPE "public"."crm_type" OWNER TO "postgres";


CREATE TYPE "public"."enrichment_status" AS ENUM (
    'pending',
    'enriching',
    'enriched',
    'enrichment_failed',
    'not_found'
);


ALTER TYPE "public"."enrichment_status" OWNER TO "postgres";


CREATE TYPE "public"."enrollment_status" AS ENUM (
    'active',
    'paused',
    'completed',
    'replied',
    'bounced',
    'unsubscribed'
);


ALTER TYPE "public"."enrollment_status" OWNER TO "postgres";


CREATE TYPE "public"."import_status" AS ENUM (
    'processing',
    'completed',
    'failed'
);


ALTER TYPE "public"."import_status" OWNER TO "postgres";


CREATE TYPE "public"."interaction_type" AS ENUM (
    'sent',
    'delivered',
    'opened',
    'clicked',
    'replied',
    'bounced',
    'failed',
    'meeting_scheduled',
    'crm_synced',
    'crm_deal_created'
);


ALTER TYPE "public"."interaction_type" OWNER TO "postgres";


CREATE TYPE "public"."lead_status" AS ENUM (
    'new',
    'contacted',
    'qualified',
    'won',
    'unqualified',
    'archived'
);


ALTER TYPE "public"."lead_status" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'manager',
    'sdr'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."member_status" AS ENUM (
    'invited',
    'active',
    'suspended',
    'removed'
);


ALTER TYPE "public"."member_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_type" AS ENUM (
    'lead_replied',
    'lead_opened',
    'lead_clicked',
    'lead_bounced',
    'sync_completed',
    'integration_error',
    'member_invited',
    'member_joined',
    'usage_limit_alert',
    'trial_expiring',
    'activity_reminder',
    'meeting_reminder',
    'closer_feedback',
    'lead_won',
    'lead_lost',
    'import_completed',
    'goal_reached',
    'cadence_completed',
    'whatsapp_reply',
    'lead_inbound'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";


CREATE TYPE "public"."subscription_status" AS ENUM (
    'active',
    'past_due',
    'canceled',
    'trialing'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE TYPE "public"."sync_direction" AS ENUM (
    'push',
    'pull'
);


ALTER TYPE "public"."sync_direction" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_lead_lifecycle_direct_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := COALESCE(auth.role(), 'none');
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_changes := v_changes || jsonb_build_object(
      'status', jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  IF NEW.won_at IS DISTINCT FROM OLD.won_at THEN
    v_changes := v_changes || jsonb_build_object(
      'won_at', jsonb_build_object('from', OLD.won_at, 'to', NEW.won_at)
    );
  END IF;
  IF NEW.lost_at IS DISTINCT FROM OLD.lost_at THEN
    v_changes := v_changes || jsonb_build_object(
      'lost_at', jsonb_build_object('from', OLD.lost_at, 'to', NEW.lost_at)
    );
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log (
    org_id, user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    NEW.org_id,
    NULL,
    'lead.lifecycle_direct_update',
    'lead',
    NEW.id::text,
    jsonb_build_object(
      'changes', v_changes,
      'caller_role', v_role,
      'pg_application_name', current_setting('application_name', true),
      'note', 'UPDATE bypassed Server Actions — likely manual SQL, migration, or service-role cron'
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_lead_lifecycle_direct_update"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."audit_lead_lifecycle_direct_update"() IS 'Loga em audit_log mudanças em status/won_at/lost_at de leads quando auth.uid() IS NULL (operações fora do fluxo de Server Action — SQL manual, migration, cron service-role).';



CREATE OR REPLACE FUNCTION "public"."auto_enroll_ldr_autonomo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."auto_enroll_ldr_autonomo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_fill_decisor_from_socios"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_nome           TEXT;
  v_qualificacao   TEXT;
  v_space_pos      INT;
BEGIN
  IF NEW.first_name IS NOT NULL
     OR NEW.last_name IS NOT NULL
     OR NEW.job_title IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.socios IS NULL OR jsonb_array_length(NEW.socios) = 0 THEN
    RETURN NEW;
  END IF;

  v_nome := trim(NEW.socios -> 0 ->> 'nome');
  v_qualificacao := trim(NEW.socios -> 0 ->> 'qualificacao');

  IF v_nome IS NULL OR v_nome = '' THEN
    RETURN NEW;
  END IF;

  v_space_pos := position(' ' in v_nome);
  IF v_space_pos > 0 THEN
    NEW.first_name := substring(v_nome from 1 for v_space_pos - 1);
    NEW.last_name := substring(v_nome from v_space_pos + 1);
  ELSE
    NEW.first_name := v_nome;
  END IF;

  IF v_qualificacao IS NOT NULL AND v_qualificacao <> '' THEN
    NEW.job_title := v_qualificacao;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_fill_decisor_from_socios"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_fill_segmento"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.segmento IS NULL OR NEW.segmento = '' THEN
    NEW.segmento := derive_segmento(NEW.cnae, NEW.razao_social, NEW.nome_fantasia);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_fill_segmento"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_fill_website"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF (NEW.website IS NULL OR NEW.website = '')
     AND NEW.email IS NOT NULL THEN
    NEW.website := extract_website_from_email(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_fill_website"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_skip_ineligible_call_transcription"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.transcription_status IS NOT NULL AND NEW.transcription_status != 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.duration_seconds = 0 THEN
    NEW.transcription_status := 'skipped';
    NEW.transcription_error := 'duration_zero';
  ELSIF NEW.status = 'not_connected' AND NEW.duration_seconds < 30 THEN
    NEW.transcription_status := 'skipped';
    NEW.transcription_error := 'duration_zero';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_skip_ineligible_call_transcription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buscar_decisor_empresa"("p_empresa_id" "uuid") RETURNS TABLE("nome_socio" "text", "telefone_lemit" "text", "email_lemit" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT s.nome_socio, s.telefone_lemit, s.email_lemit
  FROM public.ldr_socios s
  WHERE s.empresa_id = p_empresa_id
    AND s.eh_decisor_provavel = true
  LIMIT 1;
$$;


ALTER FUNCTION "public"."buscar_decisor_empresa"("p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buscar_empresa_validada_para_distribuir"() RETURNS TABLE("id" "uuid", "cnpj" "text", "razao_social" "text", "nome_fantasia" "text", "nome_curto" "text", "porte" "text", "uf" "text", "municipio" "text", "score_icp_ia" integer, "analise_ia" "text", "decisor_sugerido" "text", "prioridade" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT 
    e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.nome_curto,
    e.porte, e.uf, e.municipio, e.score_icp_ia, e.analise_ia,
    e.decisor_sugerido, e.prioridade
  FROM public.ldr_empresas e
  WHERE e.status_ldr = 'validado'
  ORDER BY e.score_icp_ia DESC NULLS LAST
  LIMIT 1;
$$;


ALTER FUNCTION "public"."buscar_empresa_validada_para_distribuir"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buscar_proximo_decisor_para_ligar"() RETURNS SETOF json
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  SELECT row_to_json(t)
  FROM (
    SELECT 
      s.id as socio_id,
      COALESCE(s.nome_curto, s.nome_socio)::text as nome_socio,
      s.telefone_lemit::text as telefone_lemit,
      s.empresa_id,
      e.razao_social::text as razao_social,
      e.nome_fantasia::text as nome_fantasia,
      e.nome_curto::text as nome_curto,
      e.score_icp_ia
    FROM public.ldr_socios s
    JOIN public.ldr_empresas e ON s.empresa_id = e.id
    WHERE s.eh_decisor_provavel = true 
      AND s.telefone_lemit IS NOT NULL 
      AND s.telefone_lemit != ''
      AND e.status_ldr = 'aprovado_icp'
      AND s.status_validacao IN ('pendente', 'tentando')
      AND s.tentativas_ligacao < 5
      AND (s.ultima_ligacao_at IS NULL OR s.ultima_ligacao_at < NOW() - INTERVAL '4 hours')
    ORDER BY 
      s.tentativas_ligacao ASC,
      e.score_icp_ia DESC NULLS LAST
    LIMIT 1
  ) t;
END;
$$;


ALTER FUNCTION "public"."buscar_proximo_decisor_para_ligar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_engagement_score"("p_lead_id" "uuid") RETURNS smallint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_score NUMERIC := 0;
  v_weight NUMERIC;
  v_decay NUMERIC;
  v_days NUMERIC;
  v_has_interactions BOOLEAN := FALSE;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT type, channel, created_at
    FROM interactions
    WHERE lead_id = p_lead_id
      AND created_at > now() - interval '90 days'
  LOOP
    v_has_interactions := TRUE;

    v_weight := CASE
      WHEN rec.type = 'sent' AND rec.channel = 'phone' THEN 5
      WHEN rec.type = 'sent' AND rec.channel = 'whatsapp' THEN 4
      WHEN rec.type = 'sent' AND rec.channel = 'linkedin' THEN 3
      WHEN rec.type = 'sent' AND rec.channel = 'email' THEN 2
      WHEN rec.type = 'sent' AND rec.channel = 'research' THEN 1
      WHEN rec.type = 'sent' AND rec.channel = 'system' THEN 0
      WHEN rec.type = 'sent' THEN 2

      WHEN rec.type = 'replied' AND rec.channel = 'whatsapp' THEN 20
      WHEN rec.type = 'replied' THEN 25

      WHEN rec.type = 'failed' AND rec.channel = 'whatsapp' THEN -3
      WHEN rec.type = 'failed' THEN -5

      WHEN rec.type = 'delivered' THEN 3
      WHEN rec.type = 'opened' THEN 5
      WHEN rec.type = 'clicked' THEN 10
      WHEN rec.type = 'meeting_scheduled' THEN 30
      WHEN rec.type = 'bounced' THEN -10
      ELSE 0
    END;

    v_days := EXTRACT(EPOCH FROM (now() - rec.created_at)) / 86400.0;
    v_decay := GREATEST(0.1, 1.0 - (v_days / 90.0));

    v_score := v_score + (v_weight * v_decay);
  END LOOP;

  IF NOT v_has_interactions THEN
    IF NOT EXISTS (SELECT 1 FROM interactions WHERE lead_id = p_lead_id LIMIT 1) THEN
      RETURN NULL;
    END IF;
    RETURN 0;
  END IF;

  RETURN LEAST(100, GREATEST(0, ROUND(v_score)))::SMALLINT;
END;
$$;


ALTER FUNCTION "public"."calculate_engagement_score"("p_lead_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_next_step_due"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  step RECORD;
  raw_due timestamptz;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT delay_days, delay_hours INTO step
    FROM cadence_steps
    WHERE cadence_id = NEW.cadence_id AND step_order = NEW.current_step;

    IF FOUND THEN
      raw_due := now() + make_interval(days => step.delay_days, hours => step.delay_hours);
      NEW.next_step_due := public.skip_weekend_brt(raw_due);
    ELSE
      -- Step not found — set to now() so the engine can mark as completed
      NEW.next_step_due := now();
    END IF;
  ELSIF NEW.status IN ('completed', 'replied', 'bounced', 'unsubscribed', 'paused') THEN
    NEW.next_step_due := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_next_step_due"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_norm        TEXT;
  v_numbers     TEXT[];
  v_max_reais   NUMERIC;
  v_open_ended  BOOLEAN := false;
BEGIN
  IF faixa_input IS NULL OR trim(faixa_input) = '' THEN
    RETURN NULL;
  END IF;

  v_norm := lower(faixa_input);

  IF v_norm ~ '(mais de|acima de)' THEN
    v_open_ended := true;
  END IF;

  SELECT array_agg(m[1] ORDER BY ord) INTO v_numbers
  FROM regexp_matches(v_norm, '\d+', 'g') WITH ORDINALITY AS t(m, ord);

  IF v_numbers IS NULL OR array_length(v_numbers, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  v_max_reais := v_numbers[array_length(v_numbers, 1)]::NUMERIC;

  IF v_norm ~ 'milh' THEN
    v_max_reais := v_max_reais * 1000000;
  ELSIF v_norm ~ 'mil' THEN
    v_max_reais := v_max_reais * 1000;
  END IF;

  IF v_open_ended THEN
    v_max_reais := v_max_reais + 1;
  END IF;

  RETURN calculate_tier_from_faturamento(v_max_reais);
END;
$$;


ALTER FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") IS 'Maps a Portuguese revenue-range label (e.g. "De 201 mil à 400 mil", "Mais de 40 milhões") to a V4 tier. Used by set_tier_from_broker when the broker column carries text instead of a number.';



CREATE OR REPLACE FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF faturamento_reais IS NULL THEN
    RETURN NULL;
  END IF;
  IF faturamento_reais <= 50000     THEN RETURN 'Não ICP';    END IF;
  IF faturamento_reais <= 100000    THEN RETURN 'Tiny';       END IF;
  IF faturamento_reais <= 200000    THEN RETURN 'Small';      END IF;
  IF faturamento_reais <= 4000000   THEN RETURN 'Medium';     END IF;
  IF faturamento_reais <= 40000000  THEN RETURN 'Large';      END IF;
  RETURN 'Enterprise';
END;
$$;


ALTER FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) IS 'Maps annual revenue in reais to the V4 tier label. Used by set_tier_from_broker trigger.';



CREATE OR REPLACE FUNCTION "public"."cleanup_provider_events"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
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
$$;


ALTER FUNCTION "public"."cleanup_provider_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_enrollments_on_terminal_lead"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.status IN ('won', 'unqualified', 'archived')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE cadence_enrollments
    SET status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE lead_id = NEW.id
      AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."close_enrollments_on_terminal_lead"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."close_enrollments_on_terminal_lead"() IS 'AFTER UPDATE trigger on leads. Marks active/paused enrollments as completed when the lead transitions to a terminal state (won, unqualified, archived).';



CREATE OR REPLACE FUNCTION "public"."complete_enrollments_on_cadence_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE cadence_enrollments
    SET status = 'completed', completed_at = now()
    WHERE cadence_id = NEW.id AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."complete_enrollments_on_cadence_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_activities_by_performer"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("performer_id" "uuid", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.performed_by, count(*)::bigint
  FROM interactions i
  LEFT JOIN leads l ON l.id = i.lead_id
  WHERE i.org_id = p_org_id
    AND i.type = 'sent'
    AND i.channel NOT IN ('system', 'calendar')
    AND i.created_at >= p_start
    AND i.created_at <  p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR i.cadence_id = ANY(p_cadence_ids))
    AND i.performed_by IS NOT NULL
    AND (l.id IS NULL OR l.status <> 'archived')
  GROUP BY i.performed_by;
END;
$$;


ALTER FUNCTION "public"."count_activities_by_performer"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_leads_by_status"("p_org_id" "uuid") RETURNS TABLE("status" "text", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.status::text, count(*) FROM leads l
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
  GROUP BY l.status;
END;
$$;


ALTER FUNCTION "public"."count_leads_by_status"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_leads_opened_by_sdr"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("performer_id" "uuid", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
  )
  SELECT r.assigned_to, count(*)::bigint
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start AND r.created_at < p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR r.cadence_id = ANY(p_cadence_ids))
  GROUP BY r.assigned_to;
END;
$$;


ALTER FUNCTION "public"."count_leads_opened_by_sdr"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_leads_opened_by_sdr_daily"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("performer_id" "uuid", "opened_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
  )
  SELECT r.assigned_to, r.created_at
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start AND r.created_at < p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR r.cadence_id = ANY(p_cadence_ids));
END;
$$;


ALTER FUNCTION "public"."count_leads_opened_by_sdr_daily"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_segmento"("cnae" "text", "razao" "text", "fantasia" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_cnae_seg TEXT;
BEGIN
  IF cnae IS NOT NULL AND trim(cnae) <> '' THEN
    v_cnae_seg := derive_segmento_from_cnae(cnae);
    IF v_cnae_seg IS NOT NULL THEN
      RETURN v_cnae_seg;
    END IF;
  END IF;
  RETURN derive_segmento_from_nome(razao, fantasia);
END;
$$;


ALTER FUNCTION "public"."derive_segmento"("cnae" "text", "razao" "text", "fantasia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_segmento_from_cnae"("cnae_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_digits TEXT;
  v_prefix INT;
BEGIN
  IF cnae_input IS NULL OR trim(cnae_input) = '' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(cnae_input, '\D', '', 'g');
  IF length(v_digits) < 2 THEN
    RETURN NULL;
  END IF;

  v_prefix := substring(v_digits from 1 for 2)::INT;

  RETURN CASE
    WHEN v_prefix BETWEEN  1 AND  3 THEN 'Agronegócio'
    WHEN v_prefix BETWEEN  5 AND  9 THEN 'Indústria Extrativa'
    WHEN v_prefix BETWEEN 10 AND 33 THEN 'Indústria'
    WHEN v_prefix = 35              THEN 'Energia'
    WHEN v_prefix BETWEEN 36 AND 39 THEN 'Saneamento / Meio Ambiente'
    WHEN v_prefix BETWEEN 41 AND 43 THEN 'Construção'
    WHEN v_prefix BETWEEN 45 AND 47 THEN 'Varejo / Comércio'
    WHEN v_prefix BETWEEN 49 AND 53 THEN 'Transporte / Logística'
    WHEN v_prefix BETWEEN 55 AND 56 THEN 'Alimentação / Hotelaria'
    WHEN v_prefix BETWEEN 58 AND 63 THEN 'Tecnologia / Mídia'
    WHEN v_prefix BETWEEN 64 AND 66 THEN 'Financeiro'
    WHEN v_prefix = 68              THEN 'Imobiliário'
    WHEN v_prefix BETWEEN 69 AND 75 THEN 'Serviços Profissionais'
    WHEN v_prefix BETWEEN 77 AND 82 THEN 'Serviços Administrativos'
    WHEN v_prefix = 84              THEN 'Administração Pública'
    WHEN v_prefix = 85              THEN 'Educação'
    WHEN v_prefix BETWEEN 86 AND 88 THEN 'Saúde'
    WHEN v_prefix BETWEEN 90 AND 93 THEN 'Cultura / Esporte'
    WHEN v_prefix BETWEEN 94 AND 96 THEN 'Outros Serviços'
    WHEN v_prefix = 97              THEN 'Serviços Domésticos'
    ELSE NULL
  END;
END;
$$;


ALTER FUNCTION "public"."derive_segmento_from_cnae"("cnae_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_segmento_from_nome"("razao" "text", "fantasia" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := lower(coalesce(fantasia, '') || ' ' || coalesce(razao, ''));
  IF trim(v_text) = '' THEN RETURN NULL; END IF;

  IF v_text ~ '(funera|memorial|cemiteri|crematori)' THEN RETURN 'Serviços Funerários'; END IF;
  IF v_text ~ '(clinic|hospital|odonto|enfermag|saude|fisioterap)' THEN RETURN 'Saúde'; END IF;
  IF v_text ~ '(petshop|pet shop|veterinar)' THEN RETURN 'Pet'; END IF;
  IF v_text ~ '(academia|fitness|crossfit|musculacao)' THEN RETURN 'Fitness / Esporte'; END IF;
  IF v_text ~ '(escola|colegio|universidade|faculdade|ensino|curso )' THEN RETURN 'Educação'; END IF;
  IF v_text ~ '(\msoft|tecnologia|sistema|softw|developer|software|ti ltda)' THEN RETURN 'Tecnologia / Software'; END IF;
  IF v_text ~ '(construc|engenharia|empreit|construt|incorporad)' THEN RETURN 'Construção'; END IF;
  IF v_text ~ '(transport|logistic|frota|fretes|express|mudanc)' THEN RETURN 'Transporte / Logística'; END IF;
  IF v_text ~ '(restaurant|lanchonete|cafeteria|alimenta|padaria|confeitaria|pizzaria)' THEN RETURN 'Alimentação'; END IF;
  IF v_text ~ '(hotel|pousada|hostel|resort)' THEN RETURN 'Hotelaria'; END IF;
  IF v_text ~ '(imobil|imovei|empreendimento)' THEN RETURN 'Imobiliário'; END IF;
  IF v_text ~ '(marketing|agencia|publicid|propagand|midia)' THEN RETURN 'Marketing / Publicidade'; END IF;
  IF v_text ~ '(agropec|agricol|fazenda|pecuari|laticini)' THEN RETURN 'Agronegócio'; END IF;
  IF v_text ~ '(\mbanc|financeir|invest|seguros|corretor de)' THEN RETURN 'Financeiro'; END IF;
  IF v_text ~ '(advocac|advogad|escritorio juridic)' THEN RETURN 'Jurídico'; END IF;
  IF v_text ~ '(consult|assessor)' THEN RETURN 'Consultoria'; END IF;
  IF v_text ~ '(beleza|salao|estetic|barbearia|cabelos|cosmetic)' THEN RETURN 'Beleza / Estética'; END IF;
  IF v_text ~ '(automotiv|veiculo|oficina mec|mecanic|autopec|locadora)' THEN RETURN 'Automotivo'; END IF;
  IF v_text ~ '(industr|fabric|metalu|usinagem)' THEN RETURN 'Indústria'; END IF;
  IF v_text ~ '(varejo|atacad|comerci|loja\M)' THEN RETURN 'Varejo / Comércio'; END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."derive_segmento_from_nome"("razao" "text", "fantasia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_due_brt"("ts" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  local_ts timestamp;
  local_date date;
  hour_of_day int;
  dow int;
BEGIN
  IF ts IS NULL THEN RETURN NULL; END IF;
  local_ts := ts AT TIME ZONE 'America/Sao_Paulo';
  local_date := local_ts::date;
  hour_of_day := extract(hour from local_ts)::int;
  dow := extract(dow from local_ts)::int;

  IF dow = 6 THEN  -- Saturday
    RETURN (local_date + interval '2 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  IF dow = 0 THEN  -- Sunday
    RETURN (local_date + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF hour_of_day < 9 THEN
    RETURN (local_date + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF hour_of_day >= 18 THEN
    IF dow = 5 THEN  -- Friday after 18h → Monday 9h
      RETURN (local_date + interval '3 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
    END IF;
    RETURN (local_date + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  RETURN ts;
END; $$;


ALTER FUNCTION "public"."effective_due_brt"("ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_website_from_email"("email_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_domain TEXT;
BEGIN
  IF email_input IS NULL OR position('@' in email_input) = 0 THEN
    RETURN NULL;
  END IF;

  v_domain := lower(split_part(email_input, '@', 2));

  IF v_domain = '' OR position('.' in v_domain) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_domain IN (
    'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
    'yahoo.com', 'yahoo.com.br', 'live.com', 'icloud.com', 'me.com', 'msn.com',
    'uol.com.br', 'bol.com.br', 'ig.com.br', 'terra.com.br', 'r7.com',
    'globo.com', 'globomail.com', 'aol.com', 'protonmail.com', 'proton.me'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN 'https://' || v_domain;
END;
$$;


ALTER FUNCTION "public"."extract_website_from_email"("email_input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_website_from_email"("email_input" "text") IS 'Returns https://<domain> for corporate emails. NULL for free-provider domains (gmail/hotmail/yahoo/etc).';



CREATE OR REPLACE FUNCTION "public"."fetch_conversion_ranking_data"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) RETURNS TABLE("lead_id" "uuid", "status" "text", "assigned_to" "uuid", "won_by" "uuid", "won_in_period" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT l.id, l.status::text, l.assigned_to, l.won_by,
    (l.status = 'won' AND l.won_at IS NOT NULL AND l.won_at >= p_start AND l.won_at < p_end)
  FROM leads l
  INNER JOIN cadence_enrollments ce ON ce.lead_id = l.id
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
    AND l.status <> 'archived'
    AND ce.enrolled_at >= p_start AND ce.enrolled_at < p_end;
END;
$$;


ALTER FUNCTION "public"."fetch_conversion_ranking_data"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fetch_inactive_enrollment_candidates"() RETURNS TABLE("enrollment_id" "uuid", "lead_id" "uuid", "org_id" "uuid", "cadence_id" "uuid", "auto_loss_reason_id" "uuid", "auto_loss_after_days" integer, "inactive_days" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  WITH last_activity AS (
    SELECT lead_id, max(created_at) AS last_at
    FROM interactions
    GROUP BY lead_id
  )
  SELECT
    ce.id AS enrollment_id,
    ce.lead_id,
    c.org_id,
    c.id AS cadence_id,
    c.auto_loss_reason_id,
    c.auto_loss_after_days,
    extract(day FROM (now() - GREATEST(ce.enrolled_at, COALESCE(la.last_at, ce.enrolled_at))))::int AS inactive_days
  FROM cadence_enrollments ce
  JOIN cadences c ON c.id = ce.cadence_id
  LEFT JOIN last_activity la ON la.lead_id = ce.lead_id
  JOIN leads l ON l.id = ce.lead_id
  WHERE ce.status = 'active'
    AND c.status = 'active'
    AND c.deleted_at IS NULL
    AND c.auto_loss_after_days IS NOT NULL
    AND c.auto_loss_reason_id IS NOT NULL
    AND l.deleted_at IS NULL
    AND l.status NOT IN ('won', 'unqualified', 'archived')
    AND now() - GREATEST(ce.enrolled_at, COALESCE(la.last_at, ce.enrolled_at)) > make_interval(days => c.auto_loss_after_days);
$$;


ALTER FUNCTION "public"."fetch_inactive_enrollment_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fetch_overdue_manual_activities"() RETURNS TABLE("lead_id" "uuid", "assigned_to" "uuid", "org_id" "uuid", "channel" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT l.id AS lead_id,
         l.assigned_to,
         l.org_id,
         cs.channel::text AS channel
  FROM cadence_enrollments ce
  JOIN cadences c        ON c.id = ce.cadence_id
  JOIN leads l           ON l.id = ce.lead_id
  JOIN cadence_steps cs  ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
  WHERE ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND ce.next_step_due < now() - interval '24 hours'
    AND cs.channel::text <> 'email'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL;
$$;


ALTER FUNCTION "public"."fetch_overdue_manual_activities"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_lead_id_by_phone"("p_org_id" "uuid", "p_phone_digits" "text", "p_sdr_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_suffix text;
  v_lead_id uuid;
BEGIN
  v_suffix := right(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), 8);
  IF length(v_suffix) < 8 THEN
    RETURN NULL;
  END IF;

  IF p_sdr_user_id IS NOT NULL THEN
    SELECT id INTO v_lead_id
    FROM leads
    WHERE org_id = p_org_id
      AND deleted_at IS NULL
      AND assigned_to = p_sdr_user_id
      AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;

    SELECT id INTO v_lead_id
    FROM leads
    WHERE org_id = p_org_id
      AND deleted_at IS NULL
      AND assigned_to = p_sdr_user_id
      AND (
        regexp_replace(phones::text, '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
        OR regexp_replace(coalesce(socios::text, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
      )
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;
  END IF;

  SELECT id INTO v_lead_id
  FROM leads
  WHERE org_id = p_org_id
    AND deleted_at IS NULL
    AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix
  ORDER BY updated_at DESC
  LIMIT 1;
  IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;

  SELECT id INTO v_lead_id
  FROM leads
  WHERE org_id = p_org_id
    AND deleted_at IS NULL
    AND (
      regexp_replace(phones::text, '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
      OR regexp_replace(coalesce(socios::text, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
    )
  ORDER BY updated_at DESC
  LIMIT 1;

  RETURN v_lead_id;
END;
$$;


ALTER FUNCTION "public"."find_lead_id_by_phone"("p_org_id" "uuid", "p_phone_digits" "text", "p_sdr_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gerar_nome_curto"("p_razao_social" "text", "p_nome_fantasia" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $_$
DECLARE
  v_fonte TEXT;
  v_limpo TEXT;
  v_palavras TEXT[];
  v_resultado TEXT;
BEGIN
  -- Prioriza nome_fantasia se existir
  IF p_nome_fantasia IS NOT NULL AND p_nome_fantasia != '' THEN
    v_fonte := p_nome_fantasia;
  ELSE
    v_fonte := p_razao_social;
  END IF;
  
  IF v_fonte IS NULL THEN RETURN NULL; END IF;
  
  -- Remove termos jurídicos e descritivos longos
  v_limpo := regexp_replace(v_fonte, 
    '\s*(LTDA\.?|ME|EPP|S\.?A\.?|S/A|EIRELI|EIRELLI|SS|SCP|SIMPLES|SOCIEDADE ANONIMA|EM RECUPERACAO JUDICIAL|SERVICOS DE COMUNICACAO MULTIMIDIA|SERVICOS DE TELECOMUNICACOES[^,]*|TELECOMUNICACOES[^,]*|TELECOM|INFRAESTRUTURA[^,]*|INSTALADORA[^,]*|COMERCIO E SERVICOS[^,]*|TECNOLOGIA APLICADA|PROVEDOR DE ACESSO[^,]*|PROVEDORES DE INTERNET[^,]*|INTERNET PROVIDER|INTERNET BANDA LARGA|& TELECOMUNICACOES|DO BRASIL|PAGAMENTOS|DA CIDADE DO RIO|SPE SORRISO)\s*', 
    ' ', 'gi');
  
  -- Remove pontos soltos e hifens soltos no final
  v_limpo := regexp_replace(v_limpo, '[\.\-]+\s*$', '', 'g');
  -- Remove espaços múltiplos
  v_limpo := regexp_replace(TRIM(v_limpo), '\s+', ' ', 'g');
  
  -- Separa em palavras
  v_palavras := string_to_array(v_limpo, ' ');
  
  -- Pega os 2 primeiros termos
  v_resultado := v_palavras[1];
  IF array_length(v_palavras, 1) > 1 AND v_palavras[2] IS NOT NULL THEN
    -- Ignora conectivos soltos como segundo termo
    IF v_palavras[2] NOT IN ('-', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'EM') THEN
      v_resultado := v_resultado || ' ' || v_palavras[2];
    ELSIF array_length(v_palavras, 1) > 2 AND v_palavras[3] IS NOT NULL THEN
      -- Se o 2o é conectivo, pega até o 3o
      v_resultado := v_resultado || ' ' || v_palavras[2] || ' ' || v_palavras[3];
    END IF;
  END IF;
  
  -- Formata em Title Case
  RETURN INITCAP(LOWER(v_resultado));
END;
$_$;


ALTER FUNCTION "public"."gerar_nome_curto"("p_razao_social" "text", "p_nome_fantasia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gerar_nome_curto_socio"("p_nome_completo" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_palavras TEXT[];
  v_primeiro TEXT;
  v_sobrenome TEXT;
  v_conectivos TEXT[] := ARRAY['de', 'da', 'do', 'dos', 'das', 'e', 'del', 'von', 'van', 'di'];
  i INTEGER;
BEGIN
  IF p_nome_completo IS NULL THEN RETURN NULL; END IF;
  
  v_palavras := string_to_array(TRIM(p_nome_completo), ' ');
  
  IF array_length(v_palavras, 1) IS NULL OR array_length(v_palavras, 1) = 0 THEN
    RETURN p_nome_completo;
  END IF;
  
  -- Primeiro nome sempre pega
  v_primeiro := INITCAP(LOWER(v_palavras[1]));
  
  -- Se só tem 1 palavra, retorna ela
  IF array_length(v_palavras, 1) = 1 THEN
    RETURN v_primeiro;
  END IF;
  
  -- Encontrar o primeiro sobrenome (pulando conectivos como De, Da, Do, Dos, Das)
  FOR i IN 2..array_length(v_palavras, 1) LOOP
    IF NOT (LOWER(v_palavras[i]) = ANY(v_conectivos)) THEN
      v_sobrenome := INITCAP(LOWER(v_palavras[i]));
      EXIT;
    END IF;
  END LOOP;
  
  -- Se todos eram conectivos, pega o último
  IF v_sobrenome IS NULL THEN
    v_sobrenome := INITCAP(LOWER(v_palavras[array_length(v_palavras, 1)]));
  END IF;
  
  RETURN v_primeiro || ' ' || v_sobrenome;
END;
$$;


ALTER FUNCTION "public"."gerar_nome_curto_socio"("p_nome_completo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_calls_for_v4sales"("p_year" integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer, "p_month" integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_metrics jsonb;
    v_calls jsonb;
BEGIN
    v_start := DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1))::TIMESTAMPTZ;
    v_end := (DATE_TRUNC('month', MAKE_DATE(p_year, p_month, 1)) + INTERVAL '1 month')::TIMESTAMPTZ;

    -- Contadores por usuário
    SELECT jsonb_agg(row_to_json(t))
    INTO v_metrics
    FROM (
        SELECT
            c.user_id::text AS enriquece_user_id,
            au.email,
            COUNT(*) AS ligacoes_realizadas,
            COUNT(*) FILTER (WHERE c.status IN ('significant', 'not_significant')) AS ligacoes_conectadas,
            ROUND(
                COUNT(*) FILTER (WHERE c.status IN ('significant', 'not_significant'))::numeric
                / NULLIF(COUNT(*), 0), 4
            ) AS pct_conectadas
        FROM calls c
        JOIN auth.users au ON au.id = c.user_id
        WHERE c.started_at >= v_start
        AND c.started_at < v_end
        AND c.type = 'outbound'
        GROUP BY c.user_id, au.email
    ) t;

    -- Log individual
    SELECT jsonb_agg(row_to_json(t))
    INTO v_calls
    FROM (
        SELECT
            c.id::text AS enriquece_call_id,
            c.user_id::text AS enriquece_user_id,
            au.email,
            c.origin,
            c.destination,
            c.started_at,
            c.duration_seconds,
            c.status::text,
            c.type::text,
            c.recording_url,
            c.transcription,
            c.transcription_status
        FROM calls c
        JOIN auth.users au ON au.id = c.user_id
        WHERE c.started_at >= v_start
        AND c.started_at < v_end
        AND c.type = 'outbound'
    ) t;

    RETURN jsonb_build_object(
        'year', p_year,
        'month', p_month,
        'metrics', COALESCE(v_metrics, '[]'::jsonb),
        'calls', COALESCE(v_calls, '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."get_calls_for_v4sales"("p_year" integer, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_calls_for_v4sales"("p_from_date" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 500) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
    v_from timestamptz;
    v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
BEGIN
    v_from := COALESCE(p_from_date::timestamptz, date_trunc('month', CURRENT_DATE));

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
        FROM (
            SELECT
                id, user_id, origin, destination, started_at, duration_seconds,
                status, type, recording_url, transcription, metadata
            FROM public.calls
            WHERE org_id = v_org_id
              AND started_at >= v_from
            ORDER BY started_at DESC
            LIMIT p_limit
        ) c
    );
END;
$$;


ALTER FUNCTION "public"."get_calls_for_v4sales"("p_from_date" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_distinct_lead_canais"() RETURNS TABLE("canal" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT l.canal
  FROM leads l
  WHERE l.org_id = public.user_org_id()
    AND l.deleted_at IS NULL
    AND l.canal IS NOT NULL
    AND l.canal <> ''
  ORDER BY l.canal;
$$;


ALTER FUNCTION "public"."get_distinct_lead_canais"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_distinct_lead_canais"() IS 'Retorna canais distintos dos leads do org do usuário autenticado. Usado pelo filtro Sub-origem.';



CREATE OR REPLACE FUNCTION "public"."get_distinct_lead_cnaes"() RETURNS TABLE("cnae" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT l.cnae
  FROM leads l
  WHERE l.org_id = public.user_org_id()
    AND l.deleted_at IS NULL
    AND l.cnae IS NOT NULL
    AND l.cnae <> ''
  ORDER BY l.cnae;
$$;


ALTER FUNCTION "public"."get_distinct_lead_cnaes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_distinct_lead_cnaes"() IS 'Retorna CNAEs distintos dos leads do org do usuário autenticado. Usado pelo filtro CNAE.';



CREATE OR REPLACE FUNCTION "public"."get_executed_steps"("p_cadence_ids" "uuid"[], "p_step_ids" "uuid"[], "p_lead_ids" "uuid"[]) RETURNS TABLE("cadence_id" "uuid", "step_id" "uuid", "lead_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.cadence_id, i.step_id, i.lead_id
  FROM interactions i
  WHERE i.org_id = public.user_org_id()
    AND i.cadence_id = ANY(p_cadence_ids)
    AND i.step_id = ANY(p_step_ids)
    AND i.lead_id = ANY(p_lead_ids)
    AND i.step_id IS NOT NULL;
END;
$$;


ALTER FUNCTION "public"."get_executed_steps"("p_cadence_ids" "uuid"[], "p_step_ids" "uuid"[], "p_lead_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_indicacoes_leads_lookup"("p_api_token" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_catalog'
    AS $$
DECLARE
  v_org_id           UUID := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_investidor_field UUID := '82f14cb5-ed2d-4dec-b292-fb7b402fd956';
  v_caller_org       UUID := public.user_org_id();
  v_result           JSONB;
BEGIN
  IF v_caller_org IS DISTINCT FROM v_org_id
     AND auth.role() <> 'service_role'
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cnpj',            cnpj,
           'nome',            LOWER(TRIM(COALESCE(nome_fantasia, razao_social))),
           'investidor',      NULLIF(TRIM(custom_field_values->>v_investidor_field::text), ''),
           'meeting_held_at', meeting_held_at
         )), '[]'::jsonb)
  INTO v_result
  FROM leads
  WHERE org_id = v_org_id
    AND canal = 'Indicação'
    AND deleted_at IS NULL
    AND NULLIF(TRIM(custom_field_values->>v_investidor_field::text), '') IS NOT NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_indicacoes_leads_lookup"("p_api_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_catalog'
    AS $$
DECLARE
  v_org_id             UUID := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_investidor_field   UUID := '82f14cb5-ed2d-4dec-b292-fb7b402fd956';
  v_caller_org         UUID := public.user_org_id();
  v_start              TIMESTAMPTZ := (make_date(p_year, p_month, 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_end                TIMESTAMPTZ := ((make_date(p_year, p_month, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_result             JSONB;
BEGIN
  IF v_caller_org IS DISTINCT FROM v_org_id
     AND auth.role() <> 'service_role'
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(row_data ORDER BY reunioes_realizadas DESC, indicacoes DESC)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'investidor',          investidor,
        'indicacoes',          indicacoes,
        'reunioes_marcadas',   reunioes_marcadas,
        'reunioes_realizadas', reunioes_realizadas,
        'cnpjs',               cnpjs,
        'nomes',               nomes
      ) AS row_data,
      reunioes_realizadas,
      indicacoes
    FROM (
      SELECT
        COALESCE(NULLIF(TRIM(custom_field_values->>v_investidor_field::text), ''), '— Sem investidor') AS investidor,
        COUNT(*) FILTER (WHERE created_at          >= v_start AND created_at          < v_end)::int AS indicacoes,
        COUNT(*) FILTER (WHERE meeting_scheduled_at >= v_start AND meeting_scheduled_at < v_end)::int AS reunioes_marcadas,
        COUNT(*) FILTER (WHERE meeting_held_at      >= v_start AND meeting_held_at      < v_end)::int AS reunioes_realizadas,
        COALESCE(array_agg(cnpj) FILTER (WHERE cnpj IS NOT NULL AND cnpj <> ''), '{}'::text[]) AS cnpjs,
        COALESCE(
          array_agg(LOWER(TRIM(COALESCE(nome_fantasia, razao_social))))
          FILTER (WHERE COALESCE(nome_fantasia, razao_social) IS NOT NULL
                  AND TRIM(COALESCE(nome_fantasia, razao_social)) <> ''),
          '{}'::text[]
        ) AS nomes
      FROM leads
      WHERE org_id = v_org_id
        AND canal = 'Indicação'
        AND deleted_at IS NULL
        AND (
             (created_at          >= v_start AND created_at          < v_end)
          OR (meeting_scheduled_at >= v_start AND meeting_scheduled_at < v_end)
          OR (meeting_held_at      >= v_start AND meeting_held_at      < v_end)
        )
      GROUP BY 1
    ) agg
  ) sorted;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text" DEFAULT NULL::"text") RETURNS SETOF json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_catalog'
    AS $$
DECLARE
  v_org_id uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
  v_caller_org uuid := public.user_org_id();
BEGIN
  IF auth.role() <> 'service_role'
     AND v_caller_org IS DISTINCT FROM v_org_id
     AND NOT public.verify_api_secret('v4sales_public_rpc', p_api_token) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT row_to_json(t)
    FROM (
      SELECT
        l.id as enriquece_lead_id,
        l.assigned_to as enriquece_user_id,
        l.cnpj, l.razao_social, l.nome_fantasia, l.porte,
        l.email, l.telefone, l.phones,
        l.first_name, l.last_name, l.job_title,
        l.status, l.lead_source, l.is_inbound, l.canal,
        l.fit_score, l.engagement_score,
        l.enrichment_status, l.enriched_at,
        l.won_at, l.lost_at, (l.won_at IS NOT NULL) as is_won,
        l.meeting_scheduled_at, l.meeting_held_at,
        l.contacted_at,
        l.created_at as created_at_enriquece,
        l.updated_at as updated_at_enriquece,
        l.deleted_at
      FROM leads l
      WHERE l.org_id = v_org_id
        AND (
          l.created_at             >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.updated_at          >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_scheduled_at>= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.meeting_held_at     >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          OR l.contacted_at        >= COALESCE(p_from_date::date, DATE_TRUNC('month', CURRENT_DATE)::date)
        )
      ORDER BY GREATEST(l.created_at, l.updated_at) DESC
    ) t;
END;
$$;


ALTER FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  org_name TEXT;
  org_slug TEXT;
  new_org_id UUID;
  starter_plan_id UUID;
BEGIN
  IF coalesce(NEW.raw_user_meta_data->>'skip_auto_org', '') = 'true' THEN
    RETURN NEW;
  END IF;

  org_name := split_part(NEW.email, '@', 2);
  org_slug := lower(replace(org_name, '.', '-')) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO organizations (name, slug, owner_id, onboarding_step)
  VALUES (org_name, org_slug, NEW.id, 0)
  RETURNING id INTO new_org_id;

  INSERT INTO organization_members (org_id, user_id, role, status, accepted_at)
  VALUES (new_org_id, NEW.id, 'manager', 'active', now());

  SELECT id INTO starter_plan_id FROM plans WHERE slug = 'starter' AND active = true LIMIT 1;

  IF starter_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (org_id, plan_id, status, current_period_end)
    VALUES (new_org_id, starter_plan_id, 'trialing', now() + INTERVAL '14 days');
  ELSE
    RAISE WARNING '[handle_new_user] Plan "starter" not found. Subscription NOT created for user %. Run seed data.', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'manager'
    AND status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_manager"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_manager"() IS 'Verifica se usuário autenticado é manager na org. SECURITY DEFINER.';



CREATE OR REPLACE FUNCTION "public"."lead_visibility_mode"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT lead_visibility_mode
  FROM organizations
  WHERE id = public.user_org_id()
$$;


ALTER FUNCTION "public"."lead_visibility_mode"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leads_without_active_enrollment"("p_org_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id FROM leads l
  WHERE l.org_id = p_org_id AND l.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM cadence_enrollments ce
      WHERE ce.lead_id = l.id AND ce.status IN ('active', 'paused')
    );
END;
$$;


ALTER FUNCTION "public"."leads_without_active_enrollment"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_overdue_enrollments_brt"("p_org_id" "uuid", "p_cutoff" timestamp with time zone) RETURNS TABLE("id" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  SELECT ce.id
  FROM cadence_enrollments ce
  WHERE ce.org_id = p_org_id
    AND ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND public.effective_due_brt(ce.next_step_due) < p_cutoff;
$$;


ALTER FUNCTION "public"."list_overdue_enrollments_brt"("p_org_id" "uuid", "p_cutoff" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_empresa_distribuida"("p_empresa_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  UPDATE public.ldr_empresas 
  SET status_ldr = 'distribuido', data_distribuicao = NOW()
  WHERE id = p_empresa_id;
$$;


ALTER FUNCTION "public"."marcar_empresa_distribuida"("p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."processar_resultado_ligacao"("p_call_id" "text", "p_call_status" "text", "p_disconnection_reason" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_empresa_id uuid;
  v_socio_id uuid;
  v_socio_nome TEXT;
  v_validado BOOLEAN := false;
BEGIN
  -- 1. Buscar o disparo original pelo call_id
  SELECT 
    pl.empresa_id,
    pl.socio_id
  INTO v_empresa_id, v_socio_id
  FROM public.ldr_pipeline_log pl
  WHERE pl.acao = 'ligacao_disparada'
    AND pl.detalhes->>'call_id' = p_call_id
  LIMIT 1;

  -- Se não encontrou o disparo, gravar resultado órfão e sair
  IF v_empresa_id IS NULL THEN
    INSERT INTO public.ldr_pipeline_log (acao, detalhes)
    VALUES ('ligacao_resultado', json_build_object(
      'call_id', p_call_id, 'call_status', p_call_status,
      'disconnection_reason', p_disconnection_reason, 'nota', 'disparo_nao_encontrado'
    )::jsonb);
    RETURN json_build_object('status', 'orphan', 'call_id', p_call_id);
  END IF;

  -- 2. Gravar resultado COM empresa_id e socio_id
  INSERT INTO public.ldr_pipeline_log (empresa_id, socio_id, acao, detalhes)
  VALUES (v_empresa_id, v_socio_id, 'ligacao_resultado', json_build_object(
    'call_id', p_call_id, 'call_status', p_call_status,
    'disconnection_reason', p_disconnection_reason
  )::jsonb);

  -- 3. Determinar se a ligação foi uma validação bem-sucedida
  -- Critério: ligação conectou E pessoa interagiu (não foi voicemail/URA/no_answer)
  IF p_call_status = 'ended' 
    AND p_disconnection_reason IN ('agent_hangup', 'user_hangup', 'max_duration_reached') THEN
    v_validado := true;
  END IF;

  -- 4. Atualizar sócio
  IF v_socio_id IS NOT NULL THEN
    IF v_validado THEN
      UPDATE public.ldr_socios SET status_validacao = 'validado' WHERE id = v_socio_id;
    END IF;
    -- Para telefone inválido, marcar direto
    IF p_disconnection_reason = 'invalid_destination' THEN
      UPDATE public.ldr_socios SET status_validacao = 'invalido' WHERE id = v_socio_id;
    END IF;
  END IF;

  -- 5. Atualizar empresa se validou
  IF v_validado THEN
    UPDATE public.ldr_empresas 
    SET status_ldr = 'validado'
    WHERE id = v_empresa_id AND status_ldr IN ('aprovado_icp', 'validando_tel');
  ELSE
    -- Se não validou, garantir que volta para aprovado_icp (para re-tentativa)
    UPDATE public.ldr_empresas 
    SET status_ldr = 'aprovado_icp'
    WHERE id = v_empresa_id AND status_ldr = 'validando_tel';
  END IF;

  RETURN json_build_object(
    'status', CASE WHEN v_validado THEN 'validado' ELSE 'nao_validado' END,
    'empresa_id', v_empresa_id,
    'call_id', p_call_id,
    'disconnection_reason', p_disconnection_reason
  );
END;
$$;


ALTER FUNCTION "public"."processar_resultado_ligacao"("p_call_id" "text", "p_call_status" "text", "p_disconnection_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."push_calls_to_v4sales"("p_year" integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer, "p_month" integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
    v_payload jsonb;
    v_request_id bigint;
BEGIN
    -- Monta o payload completo
    v_payload := get_calls_for_v4sales(p_year, p_month);

    -- Envia para o V4 Sales via HTTP
    SELECT net.http_post(
        url := 'https://ejxlbbbjyexsoltsxiqq.supabase.co/rest/v1/rpc/sync_calls_from_enriquece',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', 'REDACTED_V4FLUX_ANON_KEY_set_in_prod',
            'Authorization', 'Bearer REDACTED_V4FLUX_ANON_KEY_set_in_prod'
        ),
        body := jsonb_build_object('p_payload', v_payload)
    ) INTO v_request_id;

    RETURN jsonb_build_object(
        'status', 'dispatched',
        'request_id', v_request_id,
        'year', p_year,
        'month', p_month
    );
END;
$$;


ALTER FUNCTION "public"."push_calls_to_v4sales"("p_year" integer, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_engagement_score"("p_lead_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE leads
  SET engagement_score = calculate_engagement_score(p_lead_id),
      updated_at = now()
  WHERE id = p_lead_id;
END;
$$;


ALTER FUNCTION "public"."recalc_engagement_score"("p_lead_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_tentativa_ligacao"("p_socio_id" "uuid", "p_empresa_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_tentativas INTEGER;
  v_socios_restantes INTEGER;
BEGIN
  -- Incrementar tentativa do sócio
  UPDATE public.ldr_socios
  SET tentativas_ligacao = tentativas_ligacao + 1,
      ultima_ligacao_at = NOW(),
      status_validacao = 'tentando'
  WHERE id = p_socio_id
  RETURNING tentativas_ligacao INTO v_tentativas;

  -- Se atingiu 5 tentativas, marcar como esgotado
  IF v_tentativas >= 5 THEN
    UPDATE public.ldr_socios
    SET status_validacao = 'esgotado'
    WHERE id = p_socio_id;

    -- Verificar se há outros sócios disponíveis na mesma empresa
    SELECT COUNT(*) INTO v_socios_restantes
    FROM public.ldr_socios
    WHERE empresa_id = p_empresa_id
      AND eh_decisor_provavel = true
      AND telefone_lemit IS NOT NULL
      AND telefone_lemit != ''
      AND status_validacao IN ('pendente', 'tentando')
      AND tentativas_ligacao < 5;

    -- Se não há mais sócios, descartar empresa
    IF v_socios_restantes = 0 THEN
      UPDATE public.ldr_empresas
      SET status_ldr = 'descartado',
          motivo_descarte = 'Todos os socios esgotaram 5 tentativas de ligacao sem validacao'
      WHERE id = p_empresa_id;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "public"."registrar_tentativa_ligacao"("p_socio_id" "uuid", "p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_qualified_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.status = 'unqualified' AND OLD.status IS DISTINCT FROM 'unqualified' THEN
    NEW.lost_at := now();
    NEW.won_at := NULL;
    NEW.meeting_held_at := NULL;
  END IF;

  IF NEW.status != 'unqualified' AND OLD.status = 'unqualified' THEN
    NEW.lost_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_qualified_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tier_from_broker"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_input_id        UUID;
  v_output_id       UUID;
  v_broker_str      TEXT;
  v_old_broker_str  TEXT;
  v_broker_reais    NUMERIC;
  v_new_tier        TEXT;
BEGIN
  SELECT id INTO v_input_id
  FROM custom_fields
  WHERE org_id = NEW.org_id AND system_key = 'tier_input';

  IF v_input_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_output_id
  FROM custom_fields
  WHERE org_id = NEW.org_id AND system_key = 'tier_output';

  IF v_output_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_broker_str := NEW.custom_field_values ->> v_input_id::text;

  IF TG_OP = 'UPDATE' THEN
    v_old_broker_str := OLD.custom_field_values ->> v_input_id::text;
    IF v_broker_str IS NOT DISTINCT FROM v_old_broker_str THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_broker_str IS NULL OR v_broker_str = '' THEN
    RETURN NEW;
  END IF;

  IF v_broker_str ~ '[a-zA-Z]' THEN
    v_new_tier := calculate_tier_from_faixa(v_broker_str);
  ELSE
    BEGIN
      IF position('.' in v_broker_str) > 0 THEN
        v_broker_reais := v_broker_str::NUMERIC;
      ELSE
        v_broker_reais := v_broker_str::NUMERIC / 100;
      END IF;
      v_new_tier := calculate_tier_from_faturamento(v_broker_reais);
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;
  END IF;

  IF v_new_tier IS NOT NULL THEN
    NEW.custom_field_values := jsonb_set(
      COALESCE(NEW.custom_field_values, '{}'::jsonb),
      ARRAY[v_output_id::text],
      to_jsonb(v_new_tier),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tier_from_broker"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_tier_from_broker"() IS 'BEFORE INSERT/UPDATE trigger on leads. Auto-fills tier_output custom_field whenever tier_input (Faturamento Broker) changes. No-op for orgs that have not marked the system_keys.';



CREATE OR REPLACE FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  local_ts timestamp;
  dow int;
BEGIN
  IF ts IS NULL THEN
    RETURN NULL;
  END IF;

  local_ts := ts AT TIME ZONE 'America/Sao_Paulo';
  -- extract dow: 0 = Sunday, 6 = Saturday
  dow := EXTRACT(DOW FROM local_ts)::int;

  IF dow = 6 THEN
    -- Saturday → Monday 09:00 BRT
    RETURN (date_trunc('day', local_ts) + interval '2 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  ELSIF dow = 0 THEN
    -- Sunday → Monday 09:00 BRT
    RETURN (date_trunc('day', local_ts) + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  RETURN ts;
END;
$$;


ALTER FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) IS 'Empurra timestamps que caem em sábado/domingo (timezone America/Sao_Paulo) para segunda-feira às 09:00 BRT. Usado pelo trigger calculate_next_step_due para evitar tarefas atrasadas em fim de semana.';



CREATE OR REPLACE FUNCTION "public"."trg_set_nome_curto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.nome_curto IS NULL THEN
    NEW.nome_curto := public.gerar_nome_curto(NEW.razao_social, NEW.nome_fantasia);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_set_nome_curto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_nome_curto_socio"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.nome_curto IS NULL THEN
    NEW.nome_curto := public.gerar_nome_curto_socio(NEW.nome_socio);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_set_nome_curto_socio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_recalc_engagement_score"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM recalc_engagement_score(NEW.lead_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_recalc_engagement_score"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_call_from_webhook"("p_api4com_call_id" "text", "p_record_url" "text" DEFAULT NULL::"text", "p_duration" integer DEFAULT 0, "p_started_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("id" "uuid", "lead_id" "uuid", "duration_seconds" integer, "recording_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE calls
  SET
    recording_url = COALESCE(p_record_url, calls.recording_url),
    duration_seconds = COALESCE(NULLIF(p_duration, 0), calls.duration_seconds),
    status = CASE
      WHEN p_duration >= 50 THEN 'significant'::call_status
      WHEN calls.status = 'not_connected'::call_status AND p_duration < 50 THEN 'no_contact'::call_status
      ELSE calls.status
    END,
    started_at = COALESCE(p_started_at, calls.started_at),
    updated_at = NOW()
  WHERE calls.metadata->>'api4com_call_id' = p_api4com_call_id
  RETURNING calls.id, calls.lead_id, calls.duration_seconds, calls.recording_url;
END;
$$;


ALTER FUNCTION "public"."update_call_from_webhook"("p_api4com_call_id" "text", "p_record_url" "text", "p_duration" integer, "p_started_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_socio_lemit"("p_empresa_id" "text", "p_cnpj" "text", "p_nome_socio" "text", "p_posicao" integer, "p_eh_pj" boolean, "p_telefone" "text", "p_email" "text", "p_whatsapp" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_empresa_uuid uuid;
BEGIN
  v_empresa_uuid := p_empresa_id::uuid;
  
  UPDATE public.ldr_socios 
  SET nome_socio = p_nome_socio,
    telefone_lemit = CASE WHEN p_telefone IS NOT NULL AND p_telefone != '' THEN p_telefone ELSE telefone_lemit END,
    email_lemit = CASE WHEN p_email IS NOT NULL AND p_email != '' THEN p_email ELSE email_lemit END,
    whatsapp_ativo = CASE WHEN p_whatsapp THEN true ELSE whatsapp_ativo END,
    eh_pessoa_juridica = p_eh_pj
  WHERE empresa_id = v_empresa_uuid AND posicao_societaria = p_posicao;
  
  IF FOUND THEN RETURN 'updated_by_position'; END IF;

  UPDATE public.ldr_socios
  SET telefone_lemit = CASE WHEN p_telefone IS NOT NULL AND p_telefone != '' THEN p_telefone ELSE telefone_lemit END,
    email_lemit = CASE WHEN p_email IS NOT NULL AND p_email != '' THEN p_email ELSE email_lemit END,
    whatsapp_ativo = CASE WHEN p_whatsapp THEN true ELSE whatsapp_ativo END,
    posicao_societaria = p_posicao, eh_pessoa_juridica = p_eh_pj
  WHERE empresa_id = v_empresa_uuid AND upper(nome_socio) = upper(p_nome_socio);
  
  IF FOUND THEN RETURN 'updated_by_name'; END IF;

  INSERT INTO public.ldr_socios (empresa_id, cnpj, nome_socio, posicao_societaria, eh_pessoa_juridica, telefone_lemit, email_lemit, whatsapp_ativo, status_validacao, tentativas_ligacao, max_tentativas)
  VALUES (v_empresa_uuid, p_cnpj, p_nome_socio, p_posicao, p_eh_pj, nullif(p_telefone,''), nullif(p_email,''), p_whatsapp, 'pendente', 0, 3);
  
  RETURN 'inserted';
END;
$$;


ALTER FUNCTION "public"."upsert_socio_lemit"("p_empresa_id" "text", "p_cnpj" "text", "p_nome_socio" "text", "p_posicao" integer, "p_eh_pj" boolean, "p_telefone" "text", "p_email" "text", "p_whatsapp" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT org_id FROM organization_members
  WHERE user_id = auth.uid() AND status = 'active'
  ORDER BY accepted_at DESC NULLS LAST
  LIMIT 1;
$$;


ALTER FUNCTION "public"."user_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_org_id"() IS 'Retorna org_id do usuário autenticado. Usa membro mais recentemente aceito. SECURITY DEFINER.';



CREATE OR REPLACE FUNCTION "public"."verify_api_secret"("p_name" "text", "p_token" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_catalog'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.api_secrets s
    WHERE s.name = p_name
      AND s.revoked_at IS NULL
      AND s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;


ALTER FUNCTION "public"."verify_api_secret"("p_name" "text", "p_token" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "channel" "public"."channel_type" NOT NULL,
    "instructions" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "usage_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "generation_count" integer DEFAULT 0 NOT NULL,
    "daily_limit" integer NOT NULL,
    CONSTRAINT "chk_ai_usage_limit" CHECK ((("daily_limit" > 0) OR ("daily_limit" = '-1'::integer))),
    CONSTRAINT "chk_ai_usage_positive" CHECK (("generation_count" >= 0))
);


ALTER TABLE "public"."ai_usage" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_usage" IS 'Tracking diário de uso de AI por organização';



COMMENT ON COLUMN "public"."ai_usage"."daily_limit" IS 'Limite diário. -1 = ilimitado (Enterprise)';



CREATE TABLE IF NOT EXISTS "public"."api4com_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ramal" "text" NOT NULL,
    "api_key_encrypted" "text",
    "base_url" "text" DEFAULT 'https://api.api4com.com/api/v1/'::"text" NOT NULL,
    "status" "text" DEFAULT 'disconnected'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sip_domain" "text",
    "sip_password_encrypted" "text",
    CONSTRAINT "api4com_connections_status_check" CHECK (("status" = ANY (ARRAY['connected'::"text", 'disconnected'::"text", 'error'::"text", 'syncing'::"text"])))
);


ALTER TABLE "public"."api4com_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{leads.write}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_secrets" (
    "name" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."api_secrets" OWNER TO "postgres";


COMMENT ON TABLE "public"."api_secrets" IS 'Shared secrets for anon-callable RPCs. token_hash = sha256(plain).';



CREATE TABLE IF NOT EXISTS "public"."apollo_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "status" "text" DEFAULT 'connected'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "apollo_connections_status_check" CHECK (("status" = ANY (ARRAY['connected'::"text", 'disconnected'::"text", 'error'::"text", 'syncing'::"text"])))
);


ALTER TABLE "public"."apollo_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cadence_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cadence_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "current_step" integer DEFAULT 1 NOT NULL,
    "status" "public"."enrollment_status" DEFAULT 'active'::"public"."enrollment_status" NOT NULL,
    "next_step_due" timestamp with time zone,
    "enrolled_by" "uuid",
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "loss_reason_id" "uuid",
    "loss_notes" "text",
    "scheduled_start_at" timestamp with time zone,
    "org_id" "uuid" NOT NULL,
    CONSTRAINT "chk_enrollments_step_positive" CHECK (("current_step" > 0))
);


ALTER TABLE "public"."cadence_enrollments" OWNER TO "postgres";


COMMENT ON TABLE "public"."cadence_enrollments" IS 'Inscrição de leads em cadências de prospecção';



COMMENT ON COLUMN "public"."cadence_enrollments"."next_step_due" IS 'Calculado automaticamente pelo trigger set_next_step_due';



COMMENT ON COLUMN "public"."cadence_enrollments"."scheduled_start_at" IS 'Data agendada para ativação automática de enrollment pausado (prospecção futura)';



CREATE TABLE IF NOT EXISTS "public"."cadence_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cadence_id" "uuid" NOT NULL,
    "step_order" integer NOT NULL,
    "channel" "public"."channel_type" NOT NULL,
    "template_id" "uuid",
    "delay_days" integer DEFAULT 0 NOT NULL,
    "delay_hours" integer DEFAULT 0 NOT NULL,
    "ai_personalization" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activity_name" "text",
    "instructions" "text",
    "reply_type" "text" DEFAULT 'new_conversation'::"text" NOT NULL,
    "template_id_b" "uuid",
    "ab_enabled" boolean DEFAULT false NOT NULL,
    "ab_distribution" integer DEFAULT 50 NOT NULL,
    "ab_winner_variant" "text",
    "ab_winner_at" timestamp with time zone,
    "ab_enabled_at" timestamp with time zone,
    CONSTRAINT "cadence_steps_ab_distribution_check" CHECK ((("ab_distribution" >= 1) AND ("ab_distribution" <= 99))),
    CONSTRAINT "cadence_steps_ab_winner_variant_check" CHECK (("ab_winner_variant" = ANY (ARRAY['A'::"text", 'B'::"text"]))),
    CONSTRAINT "cadence_steps_reply_type_check" CHECK (("reply_type" = ANY (ARRAY['new_conversation'::"text", 'reply'::"text"]))),
    CONSTRAINT "chk_steps_delay_positive" CHECK ((("delay_days" >= 0) AND ("delay_hours" >= 0))),
    CONSTRAINT "chk_steps_order_positive" CHECK (("step_order" > 0))
);


ALTER TABLE "public"."cadence_steps" OWNER TO "postgres";


COMMENT ON TABLE "public"."cadence_steps" IS 'Passos individuais dentro de uma cadência';



COMMENT ON COLUMN "public"."cadence_steps"."delay_days" IS 'Dias de espera antes de executar este passo';



COMMENT ON COLUMN "public"."cadence_steps"."ai_personalization" IS 'Se true, mensagem será personalizada por AI antes do envio';



CREATE TABLE IF NOT EXISTS "public"."cadences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "public"."cadence_status" DEFAULT 'draft'::"public"."cadence_status" NOT NULL,
    "total_steps" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "origin" "text" DEFAULT 'outbound'::"text" NOT NULL,
    "type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "auto_loss_after_days" integer,
    "auto_loss_reason_id" "uuid",
    CONSTRAINT "cadences_origin_check" CHECK (("origin" = ANY (ARRAY['inbound_active'::"text", 'inbound_passive'::"text", 'outbound'::"text"]))),
    CONSTRAINT "cadences_priority_check" CHECK (("priority" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "cadences_type_check" CHECK (("type" = ANY (ARRAY['standard'::"text", 'auto_email'::"text"]))),
    CONSTRAINT "chk_cadences_total_steps" CHECK (("total_steps" >= 0))
);


ALTER TABLE "public"."cadences" OWNER TO "postgres";


COMMENT ON TABLE "public"."cadences" IS 'Cadências de prospecção (sequências automatizadas de contato)';



CREATE TABLE IF NOT EXISTS "public"."calendar_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token_encrypted" "text" NOT NULL,
    "refresh_token_encrypted" "text" NOT NULL,
    "token_expires_at" timestamp with time zone NOT NULL,
    "calendar_email" "text" NOT NULL,
    "status" "public"."connection_status" DEFAULT 'connected'::"public"."connection_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."calendar_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."calendar_connections" IS 'Conexões Google Calendar por usuário';



CREATE TABLE IF NOT EXISTS "public"."call_daily_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "daily_target" integer DEFAULT 20 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_call_daily_target_positive" CHECK (("daily_target" >= 0))
);


ALTER TABLE "public"."call_daily_targets" OWNER TO "postgres";


COMMENT ON TABLE "public"."call_daily_targets" IS 'Meta diária de ligações por vendedor (override org-level)';



CREATE TABLE IF NOT EXISTS "public"."call_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "call_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."call_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "origin" "text" NOT NULL,
    "destination" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_seconds" integer DEFAULT 0 NOT NULL,
    "status" "public"."call_status" DEFAULT 'not_connected'::"public"."call_status" NOT NULL,
    "type" "public"."call_type" DEFAULT 'outbound'::"public"."call_type" NOT NULL,
    "cost" numeric(10,4),
    "recording_url" "text",
    "notes" "text",
    "is_important" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "transcription" "text",
    "transcription_status" "text" DEFAULT 'pending'::"text",
    "transcription_error" "text",
    "connected" boolean DEFAULT false NOT NULL,
    "answered_at" timestamp with time zone,
    "hangup_cause" "text",
    "recording_storage_path" "text",
    CONSTRAINT "calls_transcription_status_check" CHECK (("transcription_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."calls" OWNER TO "postgres";


COMMENT ON COLUMN "public"."calls"."metadata" IS 'Stores integration metadata (e.g. api4com_call_id for webhook correlation)';



COMMENT ON COLUMN "public"."calls"."connected" IS 'True quando a chamada foi atendida. Source of truth para Sales Hub e dashboards externos. Preenchido pelo webhook (answered_at != NULL) ou pelo reconcile (hangup_cause=NORMAL_CLEARING AND duration>0).';



COMMENT ON COLUMN "public"."calls"."answered_at" IS 'Timestamp do channel-answer da API4COM (preenchido pelo webhook). NULL para calls não atendidas ou ingeridas via REST/reconcile.';



COMMENT ON COLUMN "public"."calls"."hangup_cause" IS 'FreeSWITCH hangup cause da API4COM (NORMAL_CLEARING, NO_ANSWER, USER_BUSY, CALL_REJECTED, etc.). Preenchido pelo webhook (channel-hangup) e reconcile.';



CREATE TABLE IF NOT EXISTS "public"."calls_dedupe_backup_20260517" (
    "id" "uuid",
    "org_id" "uuid",
    "user_id" "uuid",
    "lead_id" "uuid",
    "origin" "text",
    "destination" "text",
    "started_at" timestamp with time zone,
    "duration_seconds" integer,
    "status" "public"."call_status",
    "type" "public"."call_type",
    "cost" numeric(10,4),
    "recording_url" "text",
    "notes" "text",
    "is_important" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "metadata" "jsonb",
    "transcription" "text",
    "transcription_status" "text",
    "transcription_error" "text",
    "connected" boolean,
    "answered_at" timestamp with time zone,
    "hangup_cause" "text"
);


ALTER TABLE "public"."calls_dedupe_backup_20260517" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls_ghost_backup_20260517" (
    "id" "uuid",
    "org_id" "uuid",
    "user_id" "uuid",
    "lead_id" "uuid",
    "origin" "text",
    "destination" "text",
    "started_at" timestamp with time zone,
    "duration_seconds" integer,
    "status" "public"."call_status",
    "type" "public"."call_type",
    "cost" numeric(10,4),
    "recording_url" "text",
    "notes" "text",
    "is_important" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "metadata" "jsonb",
    "transcription" "text",
    "transcription_status" "text",
    "transcription_error" "text",
    "connected" boolean,
    "answered_at" timestamp with time zone,
    "hangup_cause" "text"
);


ALTER TABLE "public"."calls_ghost_backup_20260517" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls_guilherme_extra_backup_20260517" (
    "id" "uuid",
    "org_id" "uuid",
    "user_id" "uuid",
    "lead_id" "uuid",
    "origin" "text",
    "destination" "text",
    "started_at" timestamp with time zone,
    "duration_seconds" integer,
    "status" "public"."call_status",
    "type" "public"."call_type",
    "cost" numeric(10,4),
    "recording_url" "text",
    "notes" "text",
    "is_important" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "metadata" "jsonb",
    "transcription" "text",
    "transcription_status" "text",
    "transcription_error" "text",
    "connected" boolean,
    "answered_at" timestamp with time zone,
    "hangup_cause" "text"
);


ALTER TABLE "public"."calls_guilherme_extra_backup_20260517" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls_refined_backup_20260517" (
    "id" "uuid",
    "org_id" "uuid",
    "user_id" "uuid",
    "lead_id" "uuid",
    "origin" "text",
    "destination" "text",
    "started_at" timestamp with time zone,
    "duration_seconds" integer,
    "status" "public"."call_status",
    "type" "public"."call_type",
    "cost" numeric(10,4),
    "recording_url" "text",
    "notes" "text",
    "is_important" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "metadata" "jsonb",
    "transcription" "text",
    "transcription_status" "text",
    "transcription_error" "text",
    "connected" boolean,
    "answered_at" timestamp with time zone,
    "hangup_cause" "text"
);


ALTER TABLE "public"."calls_refined_backup_20260517" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."closer_feedback_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "closer_id" "uuid" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "result" "public"."closer_feedback_result",
    "rating" smallint,
    "comment" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "reminder_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "closer_feedback_requests_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."closer_feedback_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."closer_feedback_requests"."reminder_sent_at" IS 'Timestamp of last reminder sent (multiple reminders allowed)';



COMMENT ON COLUMN "public"."closer_feedback_requests"."reminder_count" IS 'How many reminders have been sent so far (max 3)';



CREATE TABLE IF NOT EXISTS "public"."closers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone" "text"
);


ALTER TABLE "public"."closers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "crm_provider" "public"."crm_type" NOT NULL,
    "credentials_encrypted" "text" NOT NULL,
    "field_mapping" "jsonb",
    "status" "public"."connection_status" DEFAULT 'disconnected'::"public"."connection_status" NOT NULL,
    "last_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_pipeline_id" "text",
    "default_stage_id" "text",
    "default_responsible_user_id" "text"
);


ALTER TABLE "public"."crm_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."crm_connections" IS 'Conexões CRM (HubSpot, Pipedrive, RD Station)';



COMMENT ON COLUMN "public"."crm_connections"."credentials_encrypted" IS 'Credenciais criptografadas (NUNCA expor em logs)';



COMMENT ON COLUMN "public"."crm_connections"."field_mapping" IS 'Mapeamento de campos Flux→CRM em JSONB';



CREATE TABLE IF NOT EXISTS "public"."crm_sync_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "direction" "public"."sync_direction" NOT NULL,
    "records_synced" integer DEFAULT 0 NOT NULL,
    "errors" integer DEFAULT 0 NOT NULL,
    "duration_ms" integer,
    "error_details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_sync_records" CHECK ((("records_synced" >= 0) AND ("errors" >= 0)))
);


ALTER TABLE "public"."crm_sync_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."crm_sync_log" IS 'Log de sincronizações CRM (auditoria e debugging)';



CREATE TABLE IF NOT EXISTS "public"."custom_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "field_name" "text" NOT NULL,
    "field_type" "text" NOT NULL,
    "options" "jsonb",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "is_required_won" boolean DEFAULT false NOT NULL,
    "is_required_lost" boolean DEFAULT false NOT NULL,
    "system_key" "text",
    "is_required_meeting" boolean DEFAULT false NOT NULL,
    CONSTRAINT "custom_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['text'::"text", 'textarea'::"text", 'number'::"text", 'currency'::"text", 'date'::"text", 'datetime'::"text", 'select'::"text", 'url'::"text"])))
);


ALTER TABLE "public"."custom_fields" OWNER TO "postgres";


COMMENT ON COLUMN "public"."custom_fields"."system_key" IS 'Stable identifier for system-managed custom_fields used by triggers/automations. NULL for user-defined fields. Known keys: tier_input (Faturamento Broker), tier_output (Tier).';



CREATE TABLE IF NOT EXISTS "public"."daily_activity_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "target" integer DEFAULT 20 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_activity_goals_target_check" CHECK (("target" >= 0))
);


ALTER TABLE "public"."daily_activity_goals" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_activity_goals" IS 'Daily activity targets. user_id NULL = org-wide default.';



CREATE TABLE IF NOT EXISTS "public"."email_blacklist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_blacklist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrichment_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "status" "public"."enrichment_status" NOT NULL,
    "response_data" "jsonb",
    "error_message" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_enrichment_provider" CHECK (("provider" = ANY (ARRAY['cnpj_ws'::"text", 'lemit'::"text", 'apollo'::"text"])))
);


ALTER TABLE "public"."enrichment_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."enrichment_attempts" IS 'Log de tentativas de enrichment (retry, auditoria, debugging)';



COMMENT ON COLUMN "public"."enrichment_attempts"."provider" IS 'Provedor usado: cnpj_ws (gratuito) ou lemit (premium)';



CREATE TABLE IF NOT EXISTS "public"."fit_score_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "points" integer NOT NULL,
    "field" "text" NOT NULL,
    "operator" "text" NOT NULL,
    "value" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fit_score_rules_operator_check" CHECK (("operator" = ANY (ARRAY['contains'::"text", 'equals'::"text", 'not_empty'::"text", 'starts_with'::"text"]))),
    CONSTRAINT "fit_score_rules_points_check" CHECK (("points" <> 0))
);


ALTER TABLE "public"."fit_score_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."fit_score_rules" IS 'Fit Score rules per org. Each rule adds/subtracts points based on lead field matching.';



CREATE TABLE IF NOT EXISTS "public"."gmail_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token_encrypted" "text" NOT NULL,
    "refresh_token_encrypted" "text" NOT NULL,
    "token_expires_at" timestamp with time zone NOT NULL,
    "email_address" "text" NOT NULL,
    "status" "public"."connection_status" DEFAULT 'connected'::"public"."connection_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_signature" "text",
    "cached_signature" "text",
    "signature_cached_at" timestamp with time zone
);


ALTER TABLE "public"."gmail_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."gmail_connections" IS 'Conexões OAuth2 com Gmail por usuário';



COMMENT ON COLUMN "public"."gmail_connections"."access_token_encrypted" IS 'Token criptografado (NUNCA expor)';



CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "date" NOT NULL,
    "opportunity_target" integer DEFAULT 0 NOT NULL,
    "conversion_target" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activities_target" integer DEFAULT 0 NOT NULL,
    "leads_finished_target" integer DEFAULT 0,
    "leads_opened_target" integer DEFAULT 0 NOT NULL,
    "meetings_held_target" integer DEFAULT 0 NOT NULL,
    "meetings_scheduled_target" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


COMMENT ON TABLE "public"."goals" IS 'Metas mensais de oportunidades e conversão por organização';



COMMENT ON COLUMN "public"."goals"."month" IS 'Primeiro dia do mês (ex: 2026-02-01)';



COMMENT ON COLUMN "public"."goals"."opportunity_target" IS 'Meta de oportunidades (leads qualificados) no mês';



COMMENT ON COLUMN "public"."goals"."conversion_target" IS 'Meta de taxa de conversão (%) no mês';



CREATE TABLE IF NOT EXISTS "public"."goals_per_user" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "month" "date" NOT NULL,
    "opportunity_target" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activities_target" integer DEFAULT 0 NOT NULL,
    "conversion_target" numeric(5,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."goals_per_user" OWNER TO "postgres";


COMMENT ON TABLE "public"."goals_per_user" IS 'Metas individuais por vendedor/SDR por mês';



CREATE TABLE IF NOT EXISTS "public"."interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "cadence_id" "uuid",
    "step_id" "uuid",
    "channel" "public"."channel_type" NOT NULL,
    "type" "public"."interaction_type" NOT NULL,
    "message_content" "text",
    "external_id" "text",
    "metadata" "jsonb",
    "ai_generated" boolean DEFAULT false NOT NULL,
    "original_template_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "performed_by" "uuid"
);


ALTER TABLE "public"."interactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."interactions" IS 'Registro de todas as interações com leads (append-only)';



COMMENT ON COLUMN "public"."interactions"."external_id" IS 'ID externo do provedor (Gmail message ID, WhatsApp message ID)';



COMMENT ON COLUMN "public"."interactions"."metadata" IS 'Metadados extras: {gmail_thread_id, wa_status, open_count, click_urls}';



COMMENT ON COLUMN "public"."interactions"."ai_generated" IS 'Se true, conteúdo foi gerado/personalizado por AI';



COMMENT ON COLUMN "public"."interactions"."performed_by" IS 'User who performed/triggered this interaction (NULL for auto-executed cron steps)';



CREATE TABLE IF NOT EXISTS "public"."ldr_empresas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cnpj" character varying(14) NOT NULL,
    "razao_social" "text" NOT NULL,
    "nome_fantasia" "text",
    "segmento" character varying(100),
    "porte" character varying(20),
    "capital_social" numeric(14,2),
    "num_socios" integer,
    "natureza_juridica" "text",
    "simples" character varying(10),
    "data_abertura" "date",
    "uf" character varying(2),
    "municipio" "text",
    "endereco" "text",
    "bairro" "text",
    "cep" character varying(8),
    "telefone1" character varying(20),
    "telefone2" character varying(20),
    "email" "text",
    "score_original" integer,
    "prioridade" character varying(30),
    "pts_porte" integer,
    "pts_capital" integer,
    "pts_socios" integer,
    "pts_decisor" integer,
    "pts_email" integer,
    "pts_tel" integer,
    "pts_mei" integer,
    "lista_sp" boolean DEFAULT false,
    "lista_zapisp" boolean DEFAULT false,
    "status_ldr" character varying(30) DEFAULT 'pendente'::character varying,
    "score_icp_ia" integer,
    "analise_ia" "text",
    "decisor_sugerido" "text",
    "data_avaliacao_ia" timestamp with time zone,
    "data_enriquecimento" timestamp with time zone,
    "enriquecimento_status" character varying(20) DEFAULT 'pendente'::character varying,
    "data_distribuicao" timestamp with time zone,
    "distribuido_para" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "nome_curto" "text",
    "motivo_descarte" "text"
);


ALTER TABLE "public"."ldr_empresas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ldr_pipeline_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid",
    "socio_id" "uuid",
    "acao" character varying(50) NOT NULL,
    "detalhes" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ldr_pipeline_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ldr_socios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "cnpj" character varying(14) NOT NULL,
    "nome_socio" "text" NOT NULL,
    "posicao_societaria" integer,
    "eh_pessoa_juridica" boolean DEFAULT false,
    "telefone_lemit" character varying(20),
    "telefone_ranking" integer,
    "telefone_score" integer,
    "email_lemit" "text",
    "whatsapp_ativo" boolean,
    "eh_decisor_provavel" boolean DEFAULT false,
    "justificativa_decisor" "text",
    "status_validacao" character varying(30) DEFAULT 'pendente'::character varying,
    "tentativas_ligacao" integer DEFAULT 0,
    "max_tentativas" integer DEFAULT 3,
    "data_ultima_tentativa" timestamp with time zone,
    "data_proxima_tentativa" timestamp with time zone,
    "observacao_validacao" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ultima_ligacao_at" timestamp with time zone,
    "nome_curto" "text"
);


ALTER TABLE "public"."ldr_socios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_import_errors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "import_id" "uuid" NOT NULL,
    "row_number" integer NOT NULL,
    "cnpj" "text",
    "error_message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_import_errors_row" CHECK (("row_number" > 0))
);


ALTER TABLE "public"."lead_import_errors" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_import_errors" IS 'Erros encontrados durante importação CSV de leads';



CREATE TABLE IF NOT EXISTS "public"."lead_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "total_rows" integer DEFAULT 0 NOT NULL,
    "processed_rows" integer DEFAULT 0 NOT NULL,
    "success_count" integer DEFAULT 0 NOT NULL,
    "error_count" integer DEFAULT 0 NOT NULL,
    "status" "public"."import_status" DEFAULT 'processing'::"public"."import_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lead_source" "text",
    CONSTRAINT "chk_imports_counts" CHECK ((("success_count" >= 0) AND ("error_count" >= 0))),
    CONSTRAINT "chk_imports_processed" CHECK ((("processed_rows" >= 0) AND ("processed_rows" <= "total_rows"))),
    CONSTRAINT "chk_imports_rows_positive" CHECK (("total_rows" >= 0))
);


ALTER TABLE "public"."lead_imports" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_imports" IS 'Registro de importações CSV de leads';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cnpj" "text",
    "status" "public"."lead_status" DEFAULT 'new'::"public"."lead_status" NOT NULL,
    "enrichment_status" "public"."enrichment_status" DEFAULT 'pending'::"public"."enrichment_status" NOT NULL,
    "razao_social" "text",
    "nome_fantasia" "text",
    "endereco" "jsonb",
    "porte" "text",
    "cnae" "text",
    "situacao_cadastral" "text",
    "email" "text",
    "telefone" "text",
    "socios" "jsonb",
    "faturamento_estimado" numeric(15,2),
    "enriched_at" timestamp with time zone,
    "created_by" "uuid",
    "import_id" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "fit_score" integer,
    "assigned_to" "uuid",
    "instagram" "text",
    "linkedin" "text",
    "website" "text",
    "first_name" "text",
    "last_name" "text",
    "job_title" "text",
    "lead_source" "text",
    "is_inbound" boolean DEFAULT false NOT NULL,
    "email_bounced_at" timestamp with time zone,
    "phones" "jsonb" DEFAULT '[]'::"jsonb",
    "engagement_score" smallint,
    "source_id" "text",
    "custom_field_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "closer_id" "uuid",
    "won_by" "uuid",
    "canal" "text",
    "won_at" timestamp with time zone,
    "lost_at" timestamp with time zone,
    "contacted_at" timestamp with time zone,
    "qualified_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    "meeting_scheduled_at" timestamp with time zone,
    "segmento" "text",
    "emails" "jsonb",
    "meeting_held_at" timestamp with time zone,
    "whatsapp_invalid_at" timestamp with time zone,
    "loss_reason_id" "uuid",
    "loss_notes" "text",
    CONSTRAINT "chk_leads_cnpj_format" CHECK ((("cnpj" IS NULL) OR ("cnpj" ~ '^\d{14}$'::"text")))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


COMMENT ON TABLE "public"."leads" IS 'Leads de vendas importados via CSV ou criados manualmente';



COMMENT ON COLUMN "public"."leads"."cnpj" IS 'CNPJ com 14 dígitos sem formatação';



COMMENT ON COLUMN "public"."leads"."enrichment_status" IS 'Status do enrichment via CNPJ.ws ou Lemit';



COMMENT ON COLUMN "public"."leads"."endereco" IS 'Endereço completo em JSONB: {logradouro, numero, complemento, bairro, cidade, uf, cep}';



COMMENT ON COLUMN "public"."leads"."socios" IS 'Lista de sócios em JSONB: [{nome, qualificacao, cpf_masked}]';



COMMENT ON COLUMN "public"."leads"."deleted_at" IS 'Soft delete — NULL = ativo, TIMESTAMPTZ = excluído';



COMMENT ON COLUMN "public"."leads"."phones" IS 'Additional phone numbers: [{"tipo": "celular"|"fixo"|"whatsapp", "numero": "+55 31 99587-9787"}]';



COMMENT ON COLUMN "public"."leads"."engagement_score" IS 'Engagement temperature 0-100, computed from interactions with time decay. NULL = no interactions.';



COMMENT ON COLUMN "public"."leads"."won_at" IS 'When the lead became a real opportunity / SAL (closer confirmed meeting_done). Same as meeting_held_at by design.';



COMMENT ON COLUMN "public"."leads"."qualified_at" IS 'When the SDR scheduled the meeting and qualified the lead. Predates won_at/meeting_held_at by hours-to-days.';



COMMENT ON COLUMN "public"."leads"."emails" IS 'Array of {tipo, email} objects. When set (even []), is the source of truth for emails. null = never edited.';



COMMENT ON COLUMN "public"."leads"."meeting_held_at" IS 'When the closer confirmed the meeting actually happened (result=meeting_done). NULL until confirmation.';



COMMENT ON COLUMN "public"."leads"."whatsapp_invalid_at" IS 'Quando preenchido, indica que o telefone do lead não é WhatsApp (feedback do SDR). Steps de WhatsApp são suprimidos da fila enquanto este campo não for nulo.';



CREATE OR REPLACE VIEW "public"."leads_no_active_enrollment" WITH ("security_invoker"='true') AS
 SELECT "id",
    "org_id",
    "cnpj",
    "status",
    "enrichment_status",
    "razao_social",
    "nome_fantasia",
    "endereco",
    "porte",
    "cnae",
    "situacao_cadastral",
    "email",
    "telefone",
    "socios",
    "faturamento_estimado",
    "enriched_at",
    "created_by",
    "import_id",
    "deleted_at",
    "created_at",
    "updated_at",
    "notes",
    "fit_score",
    "assigned_to",
    "instagram",
    "linkedin",
    "website",
    "first_name",
    "last_name",
    "job_title",
    "lead_source",
    "is_inbound",
    "email_bounced_at",
    "phones",
    "engagement_score",
    "source_id",
    "custom_field_values",
    "closer_id",
    "won_by",
    "canal",
    "won_at",
    "lost_at",
    "contacted_at",
    "qualified_at",
    "archived_at",
    "meeting_scheduled_at",
    "segmento",
    "emails"
   FROM "public"."leads" "l"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."cadence_enrollments" "ce"
          WHERE (("ce"."lead_id" = "l"."id") AND ("ce"."status" = ANY (ARRAY['active'::"public"."enrollment_status", 'paused'::"public"."enrollment_status"]))))));


ALTER VIEW "public"."leads_no_active_enrollment" OWNER TO "postgres";


COMMENT ON VIEW "public"."leads_no_active_enrollment" IS 'Leads sem nenhuma enrollment ativa/pausada. Usado pelo filtro "Sem cadência".';



CREATE TABLE IF NOT EXISTS "public"."loss_reasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."loss_reasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "channel" "public"."channel_type" NOT NULL,
    "subject" "text",
    "body" "text" NOT NULL,
    "variables_used" "text"[] DEFAULT '{}'::"text"[],
    "is_system" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_templates" IS 'Templates de mensagem para email e WhatsApp';



COMMENT ON COLUMN "public"."message_templates"."variables_used" IS 'Lista de variáveis usadas: {nome_fantasia, razao_social, ...}';



COMMENT ON COLUMN "public"."message_templates"."is_system" IS 'Templates do sistema não podem ser editados pelo usuário';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "public"."notification_type" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "read_at" timestamp with time zone,
    "resource_type" "text",
    "resource_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_notifications_title_not_empty" CHECK (("char_length"("title") > 0))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'Notificações em tempo real para usuários da organização';



COMMENT ON COLUMN "public"."notifications"."type" IS 'Tipo do evento que gerou a notificação';



COMMENT ON COLUMN "public"."notifications"."read_at" IS 'Timestamp de leitura. NULL = não lida';



COMMENT ON COLUMN "public"."notifications"."resource_type" IS 'Tipo do recurso relacionado (lead, cadence, integration, member)';



COMMENT ON COLUMN "public"."notifications"."resource_id" IS 'ID do recurso relacionado para navegação';



COMMENT ON COLUMN "public"."notifications"."metadata" IS 'Dados extras do evento (JSON livre)';



CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."member_role" DEFAULT 'sdr'::"public"."member_role" NOT NULL,
    "status" "public"."member_status" DEFAULT 'invited'::"public"."member_status" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invited_expires_at" timestamp with time zone
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_members" IS 'Membros da organização com papel (manager/sdr)';



CREATE OR REPLACE VIEW "public"."org_members" AS
 SELECT "id",
    "org_id",
    "user_id",
    "role",
    "status",
    "invited_at",
    "accepted_at",
    "created_at",
    "updated_at"
   FROM "public"."organization_members";


ALTER VIEW "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_call_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "calls_enabled" boolean DEFAULT true NOT NULL,
    "default_call_type" "public"."call_type" DEFAULT 'outbound'::"public"."call_type" NOT NULL,
    "significant_threshold_seconds" integer DEFAULT 30 NOT NULL,
    "daily_call_target" integer DEFAULT 20 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dialer_simultaneous_phones" integer DEFAULT 2 NOT NULL,
    "dialer_daily_limit_per_lead" integer DEFAULT 3 NOT NULL,
    CONSTRAINT "chk_daily_target_positive" CHECK (("daily_call_target" >= 0)),
    CONSTRAINT "chk_dialer_daily_limit_per_lead" CHECK ((("dialer_daily_limit_per_lead" >= 1) AND ("dialer_daily_limit_per_lead" <= 10))),
    CONSTRAINT "chk_dialer_simultaneous_phones" CHECK ((("dialer_simultaneous_phones" >= 2) AND ("dialer_simultaneous_phones" <= 4))),
    CONSTRAINT "chk_threshold_positive" CHECK (("significant_threshold_seconds" > 0))
);


ALTER TABLE "public"."organization_call_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_call_settings" IS 'Configurações de ligações por organização';



COMMENT ON COLUMN "public"."organization_call_settings"."significant_threshold_seconds" IS 'Duração mínima em segundos para considerar ligação significativa';



COMMENT ON COLUMN "public"."organization_call_settings"."daily_call_target" IS 'Meta diária padrão de ligações da organização';



CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_customer_id" "text",
    "abm_enabled" boolean DEFAULT false NOT NULL,
    "abm_group_field" "text" DEFAULT 'razao_social'::"text" NOT NULL,
    "lead_visibility_mode" "text" DEFAULT 'all'::"text" NOT NULL,
    "onboarding_step" integer,
    "logo_url" "text",
    "member_limit_override" integer,
    CONSTRAINT "chk_organizations_member_limit_override" CHECK ((("member_limit_override" IS NULL) OR ("member_limit_override" > 0))),
    CONSTRAINT "organizations_lead_visibility_mode_check" CHECK (("lead_visibility_mode" = ANY (ARRAY['all'::"text", 'own'::"text", 'team'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON TABLE "public"."organizations" IS 'Organizações (tenants) do sistema multi-tenant';



COMMENT ON COLUMN "public"."organizations"."slug" IS 'Slug único para URL e identificação';



COMMENT ON COLUMN "public"."organizations"."owner_id" IS 'Usuário que criou a organização (primeiro manager)';



COMMENT ON COLUMN "public"."organizations"."member_limit_override" IS 'Per-org override for the member seat limit. When NULL, the limit comes from plans.included_users via the active subscription.';



CREATE TABLE IF NOT EXISTS "public"."phone_blacklist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "phone_pattern" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phone_blacklist" OWNER TO "postgres";


COMMENT ON TABLE "public"."phone_blacklist" IS 'Padrões de telefone bloqueados para ligações';



CREATE TABLE IF NOT EXISTS "public"."plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    "max_leads" integer NOT NULL,
    "max_ai_per_day" integer NOT NULL,
    "max_whatsapp_per_month" integer NOT NULL,
    "included_users" integer DEFAULT 4 NOT NULL,
    "additional_user_price_cents" integer NOT NULL,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_plans_additional_user_price" CHECK (("additional_user_price_cents" >= 0)),
    CONSTRAINT "chk_plans_included_users" CHECK ((("included_users" = '-1'::integer) OR ("included_users" > 0))),
    CONSTRAINT "chk_plans_max_leads" CHECK ((("max_leads" = '-1'::integer) OR ("max_leads" > 0))),
    CONSTRAINT "chk_plans_price_positive" CHECK (("price_cents" >= 0))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."plans" IS 'Planos de assinatura (Starter, Pro, Enterprise)';



COMMENT ON COLUMN "public"."plans"."max_ai_per_day" IS 'Limite diário de gerações AI. -1 = ilimitado';



COMMENT ON COLUMN "public"."plans"."features" IS 'Features JSON: {enrichment, crm, calendar}';



CREATE TABLE IF NOT EXISTS "public"."provider_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text",
    "payload" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid"
);


ALTER TABLE "public"."provider_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "channel" "public"."channel_type" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "notes" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "overdue_reminder_sent_at" timestamp with time zone,
    CONSTRAINT "scheduled_activities_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."scheduled_activities" OWNER TO "postgres";


COMMENT ON COLUMN "public"."scheduled_activities"."overdue_reminder_sent_at" IS 'Timestamp da notificação WhatsApp de retorno atrasado. NULL = nunca notificado. Preenchido pelo cron activity-reminders quando scheduled_at < now-2h.';



CREATE TABLE IF NOT EXISTS "public"."standard_field_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "field_key" "text" NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "is_required_won" boolean DEFAULT false NOT NULL,
    "is_required_lost" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "options" "jsonb",
    "is_required_meeting" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."standard_field_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."standard_field_settings"."options" IS 'Custom options for select-type standard fields (e.g. lead_source). Stores a JSON array of strings.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "status" "public"."subscription_status" DEFAULT 'active'::"public"."subscription_status" NOT NULL,
    "current_period_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_period_end" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    "stripe_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'Assinatura ativa da organização (1 por org)';



CREATE OR REPLACE VIEW "public"."vw_ldr_dashboard" AS
 SELECT "count"(*) AS "total",
    "count"(*) FILTER (WHERE (("status_ldr")::"text" = 'pendente'::"text")) AS "pendentes",
    "count"(*) FILTER (WHERE (("status_ldr")::"text" = 'enriquecido'::"text")) AS "enriquecidos",
    "count"(*) FILTER (WHERE (("status_ldr")::"text" = 'aprovado_icp'::"text")) AS "aprovados_icp",
    "count"(*) FILTER (WHERE (("status_ldr")::"text" = 'validado'::"text")) AS "validados",
    "count"(*) FILTER (WHERE (("status_ldr")::"text" = 'distribuido'::"text")) AS "distribuidos",
    "count"(*) FILTER (WHERE (("prioridade")::"text" = '🔥 QUENTE'::"text")) AS "quentes",
    "count"(*) FILTER (WHERE (("prioridade")::"text" = '🟠 MORNO-QUENTE'::"text")) AS "morno_quentes",
    "count"(*) FILTER (WHERE (("prioridade")::"text" = '🟡 MORNO'::"text")) AS "mornos"
   FROM "public"."ldr_empresas";


ALTER VIEW "public"."vw_ldr_dashboard" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ldr_dashboard_full" AS
 SELECT "json_build_object"('updated_at', "now"(), 'pipeline', "json_build_object"('total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"), 'pendentes', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'pendente'::"text")), 'processados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" <> 'pendente'::"text")), 'aprovados_icp', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ((("ldr_empresas"."status_ldr")::"text" = ANY ((ARRAY['aprovado_icp'::character varying, 'validando_tel'::character varying, 'validado'::character varying, 'distribuido'::character varying, 'descartado'::character varying])::"text"[])) AND ("ldr_empresas"."score_icp_ia" IS NOT NULL))), 'validados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = ANY ((ARRAY['validado'::character varying, 'distribuido'::character varying])::"text"[]))), 'distribuidos', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'distribuido'::"text")), 'atual_enriquecido', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'enriquecido'::"text")), 'atual_aprovado_icp', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'aprovado_icp'::"text")), 'atual_validando_tel', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'validando_tel'::"text")), 'atual_validado', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'validado'::"text")), 'atual_distribuido', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'distribuido'::"text")), 'atual_descartado', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."status_ldr")::"text" = 'descartado'::"text"))), 'prioridades', "json_build_object"('quentes_total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."prioridade")::"text" = '🔥 QUENTE'::"text")), 'quentes_processados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ((("ldr_empresas"."prioridade")::"text" = '🔥 QUENTE'::"text") AND (("ldr_empresas"."status_ldr")::"text" <> 'pendente'::"text"))), 'morno_quentes_total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."prioridade")::"text" = '🟠 MORNO-QUENTE'::"text")), 'morno_quentes_processados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ((("ldr_empresas"."prioridade")::"text" = '🟠 MORNO-QUENTE'::"text") AND (("ldr_empresas"."status_ldr")::"text" <> 'pendente'::"text"))), 'mornos_total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."prioridade")::"text" = '🟡 MORNO'::"text")), 'mornos_processados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ((("ldr_empresas"."prioridade")::"text" = '🟡 MORNO'::"text") AND (("ldr_empresas"."status_ldr")::"text" <> 'pendente'::"text"))), 'frios_total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."prioridade")::"text" = '🔵 FRIO'::"text")), 'frios_processados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ((("ldr_empresas"."prioridade")::"text" = '🔵 FRIO'::"text") AND (("ldr_empresas"."status_ldr")::"text" <> 'pendente'::"text")))), 'ligacoes', "json_build_object"('disparadas', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE (("ldr_pipeline_log"."acao")::"text" = 'ligacao_disparada'::"text")), 'resultados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes")::"text" <> '"placeholder"'::"text"))), 'atendidas', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'call_status'::"text") = 'ended'::"text"))), 'nao_atendidas', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'call_status'::"text") = 'not_connected'::"text"))), 'voicemail', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'disconnection_reason'::"text") = 'voicemail_reached'::"text"))), 'user_hangup', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'disconnection_reason'::"text") = 'user_hangup'::"text"))), 'max_duration', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'disconnection_reason'::"text") = 'max_duration_reached'::"text"))), 'no_answer', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'disconnection_reason'::"text") = 'dial_no_answer'::"text"))), 'agent_hangup', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE ((("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text") AND (("ldr_pipeline_log"."detalhes" ->> 'disconnection_reason'::"text") = 'agent_hangup'::"text")))), 'icp_scores', "json_build_object"('score_9', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ("ldr_empresas"."score_icp_ia" = 9)), 'score_8', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ("ldr_empresas"."score_icp_ia" = 8)), 'score_7', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ("ldr_empresas"."score_icp_ia" = 7)), 'score_6', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE ("ldr_empresas"."score_icp_ia" = 6)), 'score_lte5', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_empresas"
          WHERE (("ldr_empresas"."score_icp_ia" IS NOT NULL) AND ("ldr_empresas"."score_icp_ia" <= 5))), 'total_avaliados', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_pipeline_log"
          WHERE (("ldr_pipeline_log"."acao")::"text" = 'avaliado_ia'::"text"))), 'socios', "json_build_object"('total', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_socios"), 'com_telefone', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_socios"
          WHERE ("ldr_socios"."telefone_lemit" IS NOT NULL)), 'decisores', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_socios"
          WHERE ("ldr_socios"."eh_decisor_provavel" = true)), 'decisores_com_tel', ( SELECT "count"(*) AS "count"
           FROM "public"."ldr_socios"
          WHERE (("ldr_socios"."eh_decisor_provavel" = true) AND ("ldr_socios"."telefone_lemit" IS NOT NULL))), 'decisores_disponiveis', ( SELECT "count"(*) AS "count"
           FROM ("public"."ldr_socios" "s"
             JOIN "public"."ldr_empresas" "e" ON (("s"."empresa_id" = "e"."id")))
          WHERE (("s"."eh_decisor_provavel" = true) AND ("s"."telefone_lemit" IS NOT NULL) AND (("s"."telefone_lemit")::"text" <> ''::"text") AND (("e"."status_ldr")::"text" = 'aprovado_icp'::"text") AND (("s"."status_validacao")::"text" = ANY ((ARRAY['pendente'::character varying, 'tentando'::character varying])::"text"[])) AND ("s"."tentativas_ligacao" < 3) AND (("s"."ultima_ligacao_at" IS NULL) OR ("s"."ultima_ligacao_at" < ("now"() - '24:00:00'::interval)))))), 'cadencia_isp', "json_build_object"('enrolled', ( SELECT "count"(*) AS "count"
           FROM "public"."cadence_enrollments"
          WHERE ("cadence_enrollments"."cadence_id" = '896ce318-1c1a-4c3f-8f55-5646404f1023'::"uuid")), 'active', ( SELECT "count"(*) AS "count"
           FROM "public"."cadence_enrollments"
          WHERE (("cadence_enrollments"."cadence_id" = '896ce318-1c1a-4c3f-8f55-5646404f1023'::"uuid") AND ("cadence_enrollments"."status" = 'active'::"public"."enrollment_status"))), 'completed', ( SELECT "count"(*) AS "count"
           FROM "public"."cadence_enrollments"
          WHERE (("cadence_enrollments"."cadence_id" = '896ce318-1c1a-4c3f-8f55-5646404f1023'::"uuid") AND ("cadence_enrollments"."status" = 'completed'::"public"."enrollment_status")))), 'volume_diario', ( SELECT "json_agg"("row_to_json"("d".*)) AS "json_agg"
           FROM ( SELECT "date"("ldr_pipeline_log"."created_at") AS "dia",
                    "count"(*) FILTER (WHERE (("ldr_pipeline_log"."acao")::"text" = 'avaliado_ia'::"text")) AS "avaliacoes",
                    "count"(*) FILTER (WHERE (("ldr_pipeline_log"."acao")::"text" = 'ligacao_disparada'::"text")) AS "ligacoes",
                    "count"(*) FILTER (WHERE (("ldr_pipeline_log"."acao")::"text" = 'ligacao_resultado'::"text")) AS "resultados"
                   FROM "public"."ldr_pipeline_log"
                  GROUP BY ("date"("ldr_pipeline_log"."created_at"))
                  ORDER BY ("date"("ldr_pipeline_log"."created_at"))) "d"), 'primeiro_dia', ( SELECT "min"("date"("ldr_pipeline_log"."created_at")) AS "min"
           FROM "public"."ldr_pipeline_log"), 'dias_operacao', ( SELECT ((CURRENT_DATE - "min"("date"("ldr_pipeline_log"."created_at"))) + 1)
           FROM "public"."ldr_pipeline_log")) AS "data";


ALTER VIEW "public"."vw_ldr_dashboard_full" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ldr_para_avaliar_ia" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::character varying(14) AS "cnpj",
    NULL::"text" AS "razao_social",
    NULL::"text" AS "nome_fantasia",
    NULL::character varying(100) AS "segmento",
    NULL::character varying(20) AS "porte",
    NULL::numeric(14,2) AS "capital_social",
    NULL::character varying(2) AS "uf",
    NULL::"text" AS "municipio",
    NULL::integer AS "score_original",
    NULL::character varying(30) AS "prioridade",
    NULL::character varying(20) AS "telefone1",
    NULL::"text" AS "email",
    NULL::"text" AS "socios_lista",
    NULL::bigint AS "socios_com_telefone";


ALTER VIEW "public"."vw_ldr_para_avaliar_ia" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ldr_para_enriquecer" AS
 SELECT "id",
    "cnpj",
    "razao_social",
    "nome_fantasia",
    "segmento",
    "score_original",
    "prioridade",
    "uf",
    "municipio",
    "num_socios"
   FROM "public"."ldr_empresas"
  WHERE ((("status_ldr")::"text" = 'pendente'::"text") AND (("enriquecimento_status")::"text" = 'pendente'::"text"))
  ORDER BY
        CASE "prioridade"
            WHEN '🔥 QUENTE'::"text" THEN 1
            WHEN '🟠 MORNO-QUENTE'::"text" THEN 2
            WHEN '🟡 MORNO'::"text" THEN 3
            WHEN '🔵 FRIO'::"text" THEN 4
            ELSE NULL::integer
        END, "score_original" DESC;


ALTER VIEW "public"."vw_ldr_para_enriquecer" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ldr_para_validar_tel" AS
 SELECT "s"."id" AS "socio_id",
    "s"."nome_socio",
    "s"."telefone_lemit",
    "s"."telefone_score",
    "s"."telefone_ranking",
    "e"."id" AS "empresa_id",
    "e"."cnpj",
    "e"."razao_social",
    "e"."nome_fantasia",
    "e"."segmento",
    "e"."prioridade",
    "e"."score_icp_ia"
   FROM ("public"."ldr_socios" "s"
     JOIN "public"."ldr_empresas" "e" ON (("s"."empresa_id" = "e"."id")))
  WHERE (("s"."eh_decisor_provavel" = true) AND ("s"."telefone_lemit" IS NOT NULL) AND (("s"."status_validacao")::"text" = ANY ((ARRAY['pendente'::character varying, 'retry_agendado'::character varying])::"text"[])) AND ("s"."tentativas_ligacao" < "s"."max_tentativas") AND (("s"."data_proxima_tentativa" IS NULL) OR ("s"."data_proxima_tentativa" <= "now"())))
  ORDER BY "e"."score_icp_ia" DESC NULLS LAST, "s"."telefone_score" DESC NULLS LAST;


ALTER VIEW "public"."vw_ldr_para_validar_tel" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ldr_validados" AS
 SELECT "e"."id" AS "empresa_id",
    "e"."cnpj",
    "e"."razao_social",
    "e"."nome_fantasia",
    "e"."segmento",
    "e"."porte",
    "e"."capital_social",
    "e"."uf",
    "e"."municipio",
    "e"."telefone1" AS "telefone_empresa",
    "e"."email" AS "email_empresa",
    "e"."score_original",
    "e"."prioridade",
    "e"."score_icp_ia",
    "e"."analise_ia",
    "s"."id" AS "socio_id",
    "s"."nome_socio" AS "decisor_nome",
    "s"."telefone_lemit" AS "decisor_telefone",
    "s"."telefone_score" AS "decisor_tel_score",
    "s"."email_lemit" AS "decisor_email",
    "s"."whatsapp_ativo" AS "decisor_whatsapp"
   FROM ("public"."ldr_empresas" "e"
     JOIN "public"."ldr_socios" "s" ON (("e"."id" = "s"."empresa_id")))
  WHERE ((("e"."status_ldr")::"text" = 'validado'::"text") AND (("s"."status_validacao")::"text" = 'atendeu_confirmou'::"text"))
  ORDER BY "e"."score_icp_ia" DESC NULLS LAST, "e"."score_original" DESC;


ALTER VIEW "public"."vw_ldr_validados" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_proxima_empresa_enriquecer" AS
 SELECT "id",
    "cnpj",
    "razao_social",
    "nome_fantasia",
    "status_ldr"
   FROM "public"."ldr_empresas" "e"
  WHERE ((("status_ldr")::"text" = 'pendente'::"text") AND ("cnpj" IS NOT NULL) AND (("cnpj")::"text" <> ''::"text"))
  ORDER BY
        CASE "prioridade"
            WHEN '🔥 QUENTE'::"text" THEN 1
            WHEN '🟠 MORNO-QUENTE'::"text" THEN 2
            WHEN '🟡 MORNO'::"text" THEN 3
            WHEN '🔵 FRIO'::"text" THEN 4
            ELSE 5
        END, "created_at"
 LIMIT 1;


ALTER VIEW "public"."vw_proxima_empresa_enriquecer" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_proximo_decisor_para_ligar" AS
 SELECT "s"."id" AS "socio_id",
    COALESCE("s"."nome_curto", "s"."nome_socio") AS "nome_socio",
    ("s"."telefone_lemit")::"text" AS "telefone_lemit",
    "s"."empresa_id",
    "e"."razao_social",
    "e"."nome_fantasia",
    "e"."nome_curto",
    "e"."score_icp_ia"
   FROM ("public"."ldr_socios" "s"
     JOIN "public"."ldr_empresas" "e" ON (("s"."empresa_id" = "e"."id")))
  WHERE (("s"."eh_decisor_provavel" = true) AND ("s"."telefone_lemit" IS NOT NULL) AND (("s"."telefone_lemit")::"text" <> ''::"text") AND (("e"."status_ldr")::"text" = 'aprovado_icp'::"text") AND (("s"."status_validacao")::"text" = ANY ((ARRAY['pendente'::character varying, 'tentando'::character varying])::"text"[])) AND ("s"."tentativas_ligacao" < 5) AND (("s"."ultima_ligacao_at" IS NULL) OR ("s"."ultima_ligacao_at" < ("now"() - '04:00:00'::interval))))
  ORDER BY "s"."tentativas_ligacao", "e"."score_icp_ia" DESC NULLS LAST
 LIMIT 1;


ALTER VIEW "public"."vw_proximo_decisor_para_ligar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_endpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "secret" "text",
    "events" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."webhook_endpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'processed'::"text" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "org_id" "uuid",
    CONSTRAINT "chk_webhook_events_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processed'::"text", 'failed'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "phone_number_id" "text" NOT NULL,
    "business_account_id" "text" NOT NULL,
    "access_token_encrypted" "text" NOT NULL,
    "status" "public"."connection_status" DEFAULT 'disconnected'::"public"."connection_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."whatsapp_connections" IS 'Conexão WhatsApp Business API por organização (1 por org)';



CREATE TABLE IF NOT EXISTS "public"."whatsapp_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "plan_credits" integer DEFAULT 0 NOT NULL,
    "used_credits" integer DEFAULT 0 NOT NULL,
    "overage_count" integer DEFAULT 0 NOT NULL,
    "period" "text" NOT NULL,
    CONSTRAINT "chk_wa_credits_positive" CHECK ((("plan_credits" >= '-1'::integer) AND ("used_credits" >= 0) AND ("overage_count" >= 0))),
    CONSTRAINT "chk_wa_period_format" CHECK (("period" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "public"."whatsapp_credits" OWNER TO "postgres";


COMMENT ON TABLE "public"."whatsapp_credits" IS 'Créditos mensais de WhatsApp por organização';



COMMENT ON COLUMN "public"."whatsapp_credits"."period" IS 'Período no formato YYYY-MM (ex: 2026-02)';



CREATE TABLE IF NOT EXISTS "public"."whatsapp_instances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "instance_name" "text" NOT NULL,
    "status" "text" DEFAULT 'connecting'::"text" NOT NULL,
    "phone" "text",
    "qr_base64" "text",
    "last_error" "text",
    "last_seen_at" timestamp with time zone,
    "last_status_payload" "jsonb",
    "reconnect_attempts" integer DEFAULT 0 NOT NULL,
    "next_reconnect_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    CONSTRAINT "whatsapp_instances_status_check" CHECK (("status" = ANY (ARRAY['connecting'::"text", 'connected'::"text", 'disconnected'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."whatsapp_instances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worker_run_state" (
    "job_name" "text" NOT NULL,
    "last_run_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_status" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."worker_run_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."worker_run_state" IS 'Last-known state of each background worker. job_name = stable identifier (e.g. reconcile-api4com-calls). last_success_at drives adaptive windowing in the workers themselves.';



ALTER TABLE ONLY "public"."activity_templates"
    ADD CONSTRAINT "activity_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_org_id_usage_date_key" UNIQUE ("org_id", "usage_date");



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api4com_connections"
    ADD CONSTRAINT "api4com_connections_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."api4com_connections"
    ADD CONSTRAINT "api4com_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_secrets"
    ADD CONSTRAINT "api_secrets_pkey" PRIMARY KEY ("name", "created_at");



ALTER TABLE ONLY "public"."apollo_connections"
    ADD CONSTRAINT "apollo_connections_org_id_key" UNIQUE ("org_id");



ALTER TABLE ONLY "public"."apollo_connections"
    ADD CONSTRAINT "apollo_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cadence_steps"
    ADD CONSTRAINT "cadence_steps_cadence_id_step_order_key" UNIQUE ("cadence_id", "step_order");



ALTER TABLE ONLY "public"."cadence_steps"
    ADD CONSTRAINT "cadence_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cadences"
    ADD CONSTRAINT "cadences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_daily_targets"
    ADD CONSTRAINT "call_daily_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_feedback"
    ADD CONSTRAINT "call_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."closer_feedback_requests"
    ADD CONSTRAINT "closer_feedback_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."closer_feedback_requests"
    ADD CONSTRAINT "closer_feedback_requests_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."closers"
    ADD CONSTRAINT "closers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_connections"
    ADD CONSTRAINT "crm_connections_org_id_crm_provider_key" UNIQUE ("org_id", "crm_provider");



ALTER TABLE ONLY "public"."crm_connections"
    ADD CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_sync_log"
    ADD CONSTRAINT "crm_sync_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_fields"
    ADD CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_activity_goals"
    ADD CONSTRAINT "daily_activity_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_blacklist"
    ADD CONSTRAINT "email_blacklist_org_id_domain_key" UNIQUE ("org_id", "domain");



ALTER TABLE ONLY "public"."email_blacklist"
    ADD CONSTRAINT "email_blacklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrichment_attempts"
    ADD CONSTRAINT "enrichment_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fit_score_rules"
    ADD CONSTRAINT "fit_score_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gmail_connections"
    ADD CONSTRAINT "gmail_connections_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."gmail_connections"
    ADD CONSTRAINT "gmail_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals_per_user"
    ADD CONSTRAINT "goals_per_user_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ldr_empresas"
    ADD CONSTRAINT "ldr_empresas_cnpj_key" UNIQUE ("cnpj");



ALTER TABLE ONLY "public"."ldr_empresas"
    ADD CONSTRAINT "ldr_empresas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ldr_pipeline_log"
    ADD CONSTRAINT "ldr_pipeline_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ldr_socios"
    ADD CONSTRAINT "ldr_socios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_import_errors"
    ADD CONSTRAINT "lead_import_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_imports"
    ADD CONSTRAINT "lead_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loss_reasons"
    ADD CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_call_settings"
    ADD CONSTRAINT "organization_call_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."phone_blacklist"
    ADD CONSTRAINT "phone_blacklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_new_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_new_provider_event_id_key" UNIQUE ("provider", "event_id");



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."standard_field_settings"
    ADD CONSTRAINT "standard_field_settings_org_id_field_key_key" UNIQUE ("org_id", "field_key");



ALTER TABLE ONLY "public"."standard_field_settings"
    ADD CONSTRAINT "standard_field_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_org_id_key" UNIQUE ("org_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_daily_targets"
    ADD CONSTRAINT "uq_call_daily_targets_org_user" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."organization_call_settings"
    ADD CONSTRAINT "uq_org_call_settings_org" UNIQUE ("org_id");



ALTER TABLE ONLY "public"."phone_blacklist"
    ADD CONSTRAINT "uq_phone_blacklist_org_pattern" UNIQUE ("org_id", "phone_pattern");



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_provider_event_id_key" UNIQUE ("provider", "event_id");



ALTER TABLE ONLY "public"."whatsapp_connections"
    ADD CONSTRAINT "whatsapp_connections_org_id_key" UNIQUE ("org_id");



ALTER TABLE ONLY "public"."whatsapp_connections"
    ADD CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_credits"
    ADD CONSTRAINT "whatsapp_credits_org_id_period_key" UNIQUE ("org_id", "period");



ALTER TABLE ONLY "public"."whatsapp_credits"
    ADD CONSTRAINT "whatsapp_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_instances"
    ADD CONSTRAINT "whatsapp_instances_org_user_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."whatsapp_instances"
    ADD CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worker_run_state"
    ADD CONSTRAINT "worker_run_state_pkey" PRIMARY KEY ("job_name");



CREATE UNIQUE INDEX "custom_fields_org_system_key_uniq" ON "public"."custom_fields" USING "btree" ("org_id", "system_key") WHERE ("system_key" IS NOT NULL);



CREATE INDEX "idx_activity_templates_created_by" ON "public"."activity_templates" USING "btree" ("created_by");



CREATE INDEX "idx_activity_templates_org_channel" ON "public"."activity_templates" USING "btree" ("org_id", "channel");



CREATE INDEX "idx_ai_usage_org_date" ON "public"."ai_usage" USING "btree" ("org_id", "usage_date");



CREATE INDEX "idx_api4com_connections_user_id" ON "public"."api4com_connections" USING "btree" ("user_id");



CREATE INDEX "idx_api_keys_created_by" ON "public"."api_keys" USING "btree" ("created_by");



CREATE UNIQUE INDEX "idx_api_keys_key_hash" ON "public"."api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_api_keys_org_active" ON "public"."api_keys" USING "btree" ("org_id") WHERE ("is_active" = true);



CREATE INDEX "idx_audit_log_action" ON "public"."audit_log" USING "btree" ("org_id", "action");



CREATE INDEX "idx_audit_log_org_created" ON "public"."audit_log" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "idx_cadence_enrollments_org_id" ON "public"."cadence_enrollments" USING "btree" ("org_id");



CREATE INDEX "idx_cadence_steps_cadence" ON "public"."cadence_steps" USING "btree" ("cadence_id", "step_order");



CREATE INDEX "idx_cadence_steps_template_id" ON "public"."cadence_steps" USING "btree" ("template_id");



CREATE INDEX "idx_cadence_steps_template_id_b" ON "public"."cadence_steps" USING "btree" ("template_id_b") WHERE ("template_id_b" IS NOT NULL);



CREATE INDEX "idx_cadences_auto_loss_reason_id" ON "public"."cadences" USING "btree" ("auto_loss_reason_id") WHERE ("auto_loss_reason_id" IS NOT NULL);



CREATE INDEX "idx_cadences_created_by" ON "public"."cadences" USING "btree" ("created_by");



CREATE INDEX "idx_cadences_deleted" ON "public"."cadences" USING "btree" ("org_id", "deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_cadences_org" ON "public"."cadences" USING "btree" ("org_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_calendar_connections_user_id" ON "public"."calendar_connections" USING "btree" ("user_id");



CREATE INDEX "idx_call_daily_targets_org" ON "public"."call_daily_targets" USING "btree" ("org_id");



CREATE INDEX "idx_call_daily_targets_user_id" ON "public"."call_daily_targets" USING "btree" ("user_id");



CREATE INDEX "idx_call_feedback_call" ON "public"."call_feedback" USING "btree" ("call_id", "created_at");



CREATE INDEX "idx_call_feedback_user_id" ON "public"."call_feedback" USING "btree" ("user_id");



CREATE INDEX "idx_calls_hangup_cause" ON "public"."calls" USING "btree" ("org_id", "hangup_cause") WHERE ("hangup_cause" IS NOT NULL);



CREATE INDEX "idx_calls_lead" ON "public"."calls" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE INDEX "idx_calls_org_connected_started" ON "public"."calls" USING "btree" ("org_id", "started_at" DESC) WHERE ("connected" = true);



CREATE INDEX "idx_calls_org_started" ON "public"."calls" USING "btree" ("org_id", "started_at" DESC);



CREATE INDEX "idx_calls_org_user" ON "public"."calls" USING "btree" ("org_id", "user_id");



CREATE INDEX "idx_calls_user_id" ON "public"."calls" USING "btree" ("user_id");



CREATE INDEX "idx_closer_feedback_requests_closer_id" ON "public"."closer_feedback_requests" USING "btree" ("closer_id");



CREATE INDEX "idx_closer_feedback_requests_org_id" ON "public"."closer_feedback_requests" USING "btree" ("org_id");



CREATE INDEX "idx_closers_org_id" ON "public"."closers" USING "btree" ("org_id");



CREATE INDEX "idx_crm_sync_connection" ON "public"."crm_sync_log" USING "btree" ("connection_id", "created_at" DESC);



CREATE INDEX "idx_custom_fields_org" ON "public"."custom_fields" USING "btree" ("org_id");



CREATE INDEX "idx_daily_activity_goals_user_id" ON "public"."daily_activity_goals" USING "btree" ("user_id");



CREATE INDEX "idx_email_blacklist_org" ON "public"."email_blacklist" USING "btree" ("org_id");



CREATE INDEX "idx_empresas_cnpj" ON "public"."ldr_empresas" USING "btree" ("cnpj");



CREATE INDEX "idx_empresas_prioridade" ON "public"."ldr_empresas" USING "btree" ("prioridade");



CREATE INDEX "idx_empresas_score" ON "public"."ldr_empresas" USING "btree" ("score_original" DESC);



CREATE INDEX "idx_empresas_score_ia" ON "public"."ldr_empresas" USING "btree" ("score_icp_ia" DESC);



CREATE INDEX "idx_empresas_segmento" ON "public"."ldr_empresas" USING "btree" ("segmento");



CREATE INDEX "idx_empresas_status" ON "public"."ldr_empresas" USING "btree" ("status_ldr");



CREATE INDEX "idx_empresas_uf" ON "public"."ldr_empresas" USING "btree" ("uf");



CREATE INDEX "idx_enrichment_attempts_lead" ON "public"."enrichment_attempts" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "idx_enrichment_attempts_provider" ON "public"."enrichment_attempts" USING "btree" ("provider");



CREATE INDEX "idx_enrollments_active" ON "public"."cadence_enrollments" USING "btree" ("status", "next_step_due") WHERE ("status" = 'active'::"public"."enrollment_status");



CREATE INDEX "idx_enrollments_cadence" ON "public"."cadence_enrollments" USING "btree" ("cadence_id");



CREATE INDEX "idx_enrollments_enrolled_by" ON "public"."cadence_enrollments" USING "btree" ("enrolled_by") WHERE ("enrolled_by" IS NOT NULL);



CREATE INDEX "idx_enrollments_lead" ON "public"."cadence_enrollments" USING "btree" ("lead_id");



CREATE INDEX "idx_enrollments_loss_reason" ON "public"."cadence_enrollments" USING "btree" ("loss_reason_id") WHERE ("loss_reason_id" IS NOT NULL);



CREATE INDEX "idx_enrollments_scheduled" ON "public"."cadence_enrollments" USING "btree" ("scheduled_start_at") WHERE (("status" = 'paused'::"public"."enrollment_status") AND ("scheduled_start_at" IS NOT NULL));



CREATE UNIQUE INDEX "idx_enrollments_unique_active" ON "public"."cadence_enrollments" USING "btree" ("cadence_id", "lead_id") WHERE ("status" = ANY (ARRAY['active'::"public"."enrollment_status", 'paused'::"public"."enrollment_status"]));



CREATE UNIQUE INDEX "idx_feedback_unique_pending" ON "public"."closer_feedback_requests" USING "btree" ("lead_id", "closer_id") WHERE ("responded_at" IS NULL);



CREATE INDEX "idx_fit_score_rules_org" ON "public"."fit_score_rules" USING "btree" ("org_id");



CREATE INDEX "idx_gmail_connections_user_id" ON "public"."gmail_connections" USING "btree" ("user_id");



CREATE INDEX "idx_goals_created_by" ON "public"."goals" USING "btree" ("created_by");



CREATE UNIQUE INDEX "idx_goals_org_month" ON "public"."goals" USING "btree" ("org_id", "month");



CREATE UNIQUE INDEX "idx_goals_per_user_unique" ON "public"."goals_per_user" USING "btree" ("org_id", "user_id", "month");



CREATE INDEX "idx_goals_per_user_user_id" ON "public"."goals_per_user" USING "btree" ("user_id");



CREATE INDEX "idx_interactions_cadence" ON "public"."interactions" USING "btree" ("cadence_id") WHERE ("cadence_id" IS NOT NULL);



CREATE INDEX "idx_interactions_cadence_step_lead" ON "public"."interactions" USING "btree" ("cadence_id", "step_id", "lead_id");



CREATE INDEX "idx_interactions_lead" ON "public"."interactions" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "idx_interactions_org" ON "public"."interactions" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "idx_interactions_org_type_channel" ON "public"."interactions" USING "btree" ("org_id", "type", "channel", "created_at");



CREATE INDEX "idx_interactions_original_template_id" ON "public"."interactions" USING "btree" ("original_template_id") WHERE ("original_template_id" IS NOT NULL);



CREATE INDEX "idx_interactions_performed_by" ON "public"."interactions" USING "btree" ("performed_by") WHERE ("performed_by" IS NOT NULL);



CREATE INDEX "idx_interactions_performed_by_org" ON "public"."interactions" USING "btree" ("org_id", "performed_by") WHERE ("performed_by" IS NOT NULL);



CREATE INDEX "idx_interactions_step_variant" ON "public"."interactions" USING "btree" ("step_id", "type") WHERE ("step_id" IS NOT NULL);



CREATE INDEX "idx_interactions_type" ON "public"."interactions" USING "btree" ("org_id", "type", "created_at" DESC);



CREATE INDEX "idx_ldr_pipeline_log_empresa_id" ON "public"."ldr_pipeline_log" USING "btree" ("empresa_id");



CREATE INDEX "idx_ldr_pipeline_log_socio_id" ON "public"."ldr_pipeline_log" USING "btree" ("socio_id");



CREATE INDEX "idx_lead_import_errors_import_id" ON "public"."lead_import_errors" USING "btree" ("import_id");



CREATE INDEX "idx_lead_imports_created_by" ON "public"."lead_imports" USING "btree" ("created_by");



CREATE INDEX "idx_lead_imports_org_id" ON "public"."lead_imports" USING "btree" ("org_id");



CREATE INDEX "idx_leads_assigned_to" ON "public"."leads" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "idx_leads_assigned_to_org" ON "public"."leads" USING "btree" ("org_id", "assigned_to") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_closer_id" ON "public"."leads" USING "btree" ("closer_id") WHERE ("closer_id" IS NOT NULL);



CREATE INDEX "idx_leads_cnae" ON "public"."leads" USING "btree" ("org_id", "cnae") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_cnpj" ON "public"."leads" USING "btree" ("org_id", "cnpj");



CREATE INDEX "idx_leads_created" ON "public"."leads" USING "btree" ("org_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_created_by" ON "public"."leads" USING "btree" ("org_id", "created_by") WHERE (("created_by" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_leads_created_by_simple" ON "public"."leads" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE INDEX "idx_leads_deleted" ON "public"."leads" USING "btree" ("org_id", "deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_leads_email_bounced" ON "public"."leads" USING "btree" ("email_bounced_at") WHERE ("email_bounced_at" IS NOT NULL);



CREATE INDEX "idx_leads_engagement_score" ON "public"."leads" USING "btree" ("org_id", "engagement_score" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_enrichment" ON "public"."leads" USING "btree" ("org_id", "enrichment_status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_fit_score" ON "public"."leads" USING "btree" ("org_id", "fit_score" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_import" ON "public"."leads" USING "btree" ("import_id") WHERE ("import_id" IS NOT NULL);



CREATE INDEX "idx_leads_lost_at" ON "public"."leads" USING "btree" ("org_id", "lost_at") WHERE (("status" = 'unqualified'::"public"."lead_status") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_leads_meeting_held_at_org" ON "public"."leads" USING "btree" ("org_id", "meeting_held_at") WHERE ("meeting_held_at" IS NOT NULL);



CREATE INDEX "idx_leads_org" ON "public"."leads" USING "btree" ("org_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_org_status_won" ON "public"."leads" USING "btree" ("org_id", "status", "won_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_phone_suffix" ON "public"."leads" USING "btree" ("right"("regexp_replace"("telefone", '\D'::"text", ''::"text", 'g'::"text"), 8)) WHERE (("telefone" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_leads_porte" ON "public"."leads" USING "btree" ("org_id", "porte") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_source_id" ON "public"."leads" USING "btree" ("source_id") WHERE ("source_id" IS NOT NULL);



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("org_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_telefone" ON "public"."leads" USING "btree" ("telefone") WHERE ("telefone" IS NOT NULL);



CREATE INDEX "idx_leads_telefone_digits" ON "public"."leads" USING "btree" ("org_id", "regexp_replace"(COALESCE("telefone", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text")) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_whatsapp_invalid" ON "public"."leads" USING "btree" ("whatsapp_invalid_at") WHERE ("whatsapp_invalid_at" IS NOT NULL);



CREATE INDEX "idx_leads_won_at" ON "public"."leads" USING "btree" ("org_id", "won_at") WHERE (("status" = 'won'::"public"."lead_status") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_leads_won_by" ON "public"."leads" USING "btree" ("won_by") WHERE ("won_by" IS NOT NULL);



CREATE INDEX "idx_loss_reasons_org" ON "public"."loss_reasons" USING "btree" ("org_id");



CREATE INDEX "idx_members_org" ON "public"."organization_members" USING "btree" ("org_id");



CREATE INDEX "idx_members_user" ON "public"."organization_members" USING "btree" ("user_id") WHERE ("status" = 'active'::"public"."member_status");



CREATE INDEX "idx_message_templates_created_by" ON "public"."message_templates" USING "btree" ("created_by");



CREATE INDEX "idx_message_templates_org_id" ON "public"."message_templates" USING "btree" ("org_id");



CREATE INDEX "idx_notifications_org_id" ON "public"."notifications" USING "btree" ("org_id");



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "idx_org_call_settings_org" ON "public"."organization_call_settings" USING "btree" ("org_id");



CREATE INDEX "idx_organizations_owner_id" ON "public"."organizations" USING "btree" ("owner_id");



CREATE INDEX "idx_phone_blacklist_org" ON "public"."phone_blacklist" USING "btree" ("org_id");



CREATE INDEX "idx_provider_events_org_id" ON "public"."provider_events" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);



CREATE INDEX "idx_scheduled_activities_lead" ON "public"."scheduled_activities" USING "btree" ("lead_id");



CREATE INDEX "idx_scheduled_activities_org_id" ON "public"."scheduled_activities" USING "btree" ("org_id");



CREATE INDEX "idx_scheduled_activities_pending_overdue" ON "public"."scheduled_activities" USING "btree" ("scheduled_at") WHERE (("status" = 'pending'::"text") AND ("overdue_reminder_sent_at" IS NULL));



CREATE INDEX "idx_scheduled_activities_user_pending" ON "public"."scheduled_activities" USING "btree" ("user_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_socios_cnpj" ON "public"."ldr_socios" USING "btree" ("cnpj");



CREATE INDEX "idx_socios_decisor" ON "public"."ldr_socios" USING "btree" ("eh_decisor_provavel");



CREATE INDEX "idx_socios_empresa" ON "public"."ldr_socios" USING "btree" ("empresa_id");



CREATE INDEX "idx_socios_validacao" ON "public"."ldr_socios" USING "btree" ("status_validacao");



CREATE INDEX "idx_subscriptions_plan_id" ON "public"."subscriptions" USING "btree" ("plan_id");



CREATE INDEX "idx_wa_credits_org_period" ON "public"."whatsapp_credits" USING "btree" ("org_id", "period");



CREATE INDEX "idx_webhook_endpoints_created_by" ON "public"."webhook_endpoints" USING "btree" ("created_by");



CREATE INDEX "idx_webhook_endpoints_org_active" ON "public"."webhook_endpoints" USING "btree" ("org_id") WHERE ("is_active" = true);



CREATE INDEX "idx_webhook_events_org_id" ON "public"."webhook_events" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);



CREATE INDEX "idx_webhook_events_provider" ON "public"."webhook_events" USING "btree" ("provider", "processed_at" DESC);



CREATE INDEX "idx_webhook_events_status" ON "public"."webhook_events" USING "btree" ("status") WHERE ("status" <> 'processed'::"text");



CREATE INDEX "idx_whatsapp_instances_user_id" ON "public"."whatsapp_instances" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE UNIQUE INDEX "leads_org_id_cnpj_active_key" ON "public"."leads" USING "btree" ("org_id", "cnpj") WHERE (("deleted_at" IS NULL) AND ("cnpj" IS NOT NULL));



CREATE UNIQUE INDEX "uq_daily_goal_org_user" ON "public"."daily_activity_goals" USING "btree" ("org_id", COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE OR REPLACE VIEW "public"."vw_ldr_para_avaliar_ia" AS
 SELECT "e"."id",
    "e"."cnpj",
    "e"."razao_social",
    "e"."nome_fantasia",
    "e"."segmento",
    "e"."porte",
    "e"."capital_social",
    "e"."uf",
    "e"."municipio",
    "e"."score_original",
    "e"."prioridade",
    "e"."telefone1",
    "e"."email",
    "string_agg"("s"."nome_socio", ' | '::"text" ORDER BY "s"."posicao_societaria") AS "socios_lista",
    "count"("s"."id") FILTER (WHERE ("s"."telefone_lemit" IS NOT NULL)) AS "socios_com_telefone"
   FROM ("public"."ldr_empresas" "e"
     LEFT JOIN "public"."ldr_socios" "s" ON (("e"."id" = "s"."empresa_id")))
  WHERE (("e"."status_ldr")::"text" = 'enriquecido'::"text")
  GROUP BY "e"."id";



CREATE OR REPLACE TRIGGER "audit_lead_lifecycle_direct_update_trigger" AFTER UPDATE OF "status", "won_at", "lost_at" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."audit_lead_lifecycle_direct_update"();



CREATE OR REPLACE TRIGGER "auto_fill_decisor_trigger" BEFORE INSERT OR UPDATE OF "socios", "first_name", "last_name", "job_title" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."auto_fill_decisor_from_socios"();



CREATE OR REPLACE TRIGGER "auto_fill_segmento_trigger" BEFORE INSERT OR UPDATE OF "cnae", "razao_social", "nome_fantasia", "segmento" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."auto_fill_segmento"();



CREATE OR REPLACE TRIGGER "auto_fill_website_trigger" BEFORE INSERT OR UPDATE OF "email", "website" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."auto_fill_website"();



CREATE OR REPLACE TRIGGER "auto_skip_ineligible_call_transcription" BEFORE INSERT OR UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."auto_skip_ineligible_call_transcription"();



CREATE OR REPLACE TRIGGER "close_enrollments_on_terminal_lead_trigger" AFTER UPDATE OF "status" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."close_enrollments_on_terminal_lead"();



CREATE OR REPLACE TRIGGER "recalc_engagement_on_interaction" AFTER INSERT ON "public"."interactions" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_recalc_engagement_score"();



CREATE OR REPLACE TRIGGER "set_daily_activity_goals_updated_at" BEFORE UPDATE ON "public"."daily_activity_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_goals_per_user_updated_at" BEFORE UPDATE ON "public"."goals_per_user" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_goals_updated_at" BEFORE UPDATE ON "public"."goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_next_step_due" BEFORE INSERT OR UPDATE OF "current_step", "status" ON "public"."cadence_enrollments" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_next_step_due"();



CREATE OR REPLACE TRIGGER "set_qualified_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_qualified_at"();



CREATE OR REPLACE TRIGGER "set_tier_from_broker_trigger" BEFORE INSERT OR UPDATE OF "custom_field_values" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_tier_from_broker"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."activity_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."api4com_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."apollo_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."cadence_enrollments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."cadences" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."calendar_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."call_daily_targets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."closer_feedback_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."closers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."crm_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."daily_activity_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."gmail_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."goals_per_user" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."ldr_empresas" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."ldr_socios" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."organization_call_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."phone_blacklist" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."scheduled_activities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."standard_field_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."webhook_endpoints" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."whatsapp_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."whatsapp_instances" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."worker_run_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "tr_empresas_updated" BEFORE UPDATE ON "public"."ldr_empresas" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "tr_socios_updated" BEFORE UPDATE ON "public"."ldr_socios" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_auto_enroll_ldr_autonomo" AFTER INSERT ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."auto_enroll_ldr_autonomo"();



CREATE OR REPLACE TRIGGER "trg_auto_nome_curto" BEFORE INSERT OR UPDATE ON "public"."ldr_empresas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_nome_curto"();



CREATE OR REPLACE TRIGGER "trg_auto_nome_curto_socio" BEFORE INSERT OR UPDATE ON "public"."ldr_socios" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_nome_curto_socio"();



CREATE OR REPLACE TRIGGER "trg_complete_enrollments_on_cadence_delete" AFTER UPDATE ON "public"."cadences" FOR EACH ROW EXECUTE FUNCTION "public"."complete_enrollments_on_cadence_delete"();



CREATE OR REPLACE TRIGGER "trg_notifications_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."activity_templates"
    ADD CONSTRAINT "activity_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_templates"
    ADD CONSTRAINT "activity_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api4com_connections"
    ADD CONSTRAINT "api4com_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api4com_connections"
    ADD CONSTRAINT "api4com_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."apollo_connections"
    ADD CONSTRAINT "apollo_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "public"."cadences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_enrolled_by_fkey" FOREIGN KEY ("enrolled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "public"."loss_reasons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadence_enrollments"
    ADD CONSTRAINT "cadence_enrollments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cadence_steps"
    ADD CONSTRAINT "cadence_steps_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "public"."cadences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cadence_steps"
    ADD CONSTRAINT "cadence_steps_template_id_b_fkey" FOREIGN KEY ("template_id_b") REFERENCES "public"."message_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadence_steps"
    ADD CONSTRAINT "cadence_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadences"
    ADD CONSTRAINT "cadences_auto_loss_reason_id_fkey" FOREIGN KEY ("auto_loss_reason_id") REFERENCES "public"."loss_reasons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadences"
    ADD CONSTRAINT "cadences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cadences"
    ADD CONSTRAINT "cadences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."call_daily_targets"
    ADD CONSTRAINT "call_daily_targets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_daily_targets"
    ADD CONSTRAINT "call_daily_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."call_feedback"
    ADD CONSTRAINT "call_feedback_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_feedback"
    ADD CONSTRAINT "call_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."closer_feedback_requests"
    ADD CONSTRAINT "closer_feedback_requests_closer_id_fkey" FOREIGN KEY ("closer_id") REFERENCES "public"."closers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closer_feedback_requests"
    ADD CONSTRAINT "closer_feedback_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closer_feedback_requests"
    ADD CONSTRAINT "closer_feedback_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closers"
    ADD CONSTRAINT "closers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_connections"
    ADD CONSTRAINT "crm_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_sync_log"
    ADD CONSTRAINT "crm_sync_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."crm_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_fields"
    ADD CONSTRAINT "custom_fields_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_activity_goals"
    ADD CONSTRAINT "daily_activity_goals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_activity_goals"
    ADD CONSTRAINT "daily_activity_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_blacklist"
    ADD CONSTRAINT "email_blacklist_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrichment_attempts"
    ADD CONSTRAINT "enrichment_attempts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."fit_score_rules"
    ADD CONSTRAINT "fit_score_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gmail_connections"
    ADD CONSTRAINT "gmail_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gmail_connections"
    ADD CONSTRAINT "gmail_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals_per_user"
    ADD CONSTRAINT "goals_per_user_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals_per_user"
    ADD CONSTRAINT "goals_per_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "public"."cadences"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_original_template_id_fkey" FOREIGN KEY ("original_template_id") REFERENCES "public"."message_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."cadence_steps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ldr_pipeline_log"
    ADD CONSTRAINT "ldr_pipeline_log_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."ldr_empresas"("id");



ALTER TABLE ONLY "public"."ldr_pipeline_log"
    ADD CONSTRAINT "ldr_pipeline_log_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "public"."ldr_socios"("id");



ALTER TABLE ONLY "public"."ldr_socios"
    ADD CONSTRAINT "ldr_socios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."ldr_empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_import_errors"
    ADD CONSTRAINT "lead_import_errors_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."lead_imports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_imports"
    ADD CONSTRAINT "lead_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_imports"
    ADD CONSTRAINT "lead_imports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_closer_id_fkey" FOREIGN KEY ("closer_id") REFERENCES "public"."closers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."lead_imports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "public"."loss_reasons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_won_by_fkey" FOREIGN KEY ("won_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loss_reasons"
    ADD CONSTRAINT "loss_reasons_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_call_settings"
    ADD CONSTRAINT "organization_call_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."phone_blacklist"
    ADD CONSTRAINT "phone_blacklist_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_activities"
    ADD CONSTRAINT "scheduled_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."standard_field_settings"
    ADD CONSTRAINT "standard_field_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_connections"
    ADD CONSTRAINT "whatsapp_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_credits"
    ADD CONSTRAINT "whatsapp_credits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_instances"
    ADD CONSTRAINT "whatsapp_instances_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_instances"
    ADD CONSTRAINT "whatsapp_instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



CREATE POLICY "Managers can delete whatsapp instance" ON "public"."whatsapp_instances" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "Managers can insert standard_field_settings" ON "public"."standard_field_settings" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "Managers can insert whatsapp instance" ON "public"."whatsapp_instances" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "Managers can update standard_field_settings" ON "public"."standard_field_settings" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "Managers can update whatsapp instance" ON "public"."whatsapp_instances" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "Members can insert scheduled activities" ON "public"."scheduled_activities" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "Members can read standard_field_settings" ON "public"."standard_field_settings" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "Members can update own scheduled activities" ON "public"."scheduled_activities" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "Members can view org scheduled activities" ON "public"."scheduled_activities" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "Members can view org whatsapp instance" ON "public"."whatsapp_instances" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "Users can delete own api4com connection" ON "public"."api4com_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can insert own api4com connection" ON "public"."api4com_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can update own api4com connection" ON "public"."api4com_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can view own api4com connection" ON "public"."api4com_connections" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."activity_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_templates_org_delete" ON "public"."activity_templates" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "activity_templates_org_insert" ON "public"."activity_templates" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "activity_templates_org_read" ON "public"."activity_templates" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "activity_templates_org_update" ON "public"."activity_templates" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."ai_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_usage_org_insert" ON "public"."ai_usage" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "ai_usage_org_read" ON "public"."ai_usage" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "ai_usage_org_update" ON "public"."ai_usage" FOR UPDATE USING (("org_id" = "public"."user_org_id"())) WITH CHECK (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."api4com_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_keys_delete" ON "public"."api_keys" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "api_keys_insert" ON "public"."api_keys" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "api_keys_select" ON "public"."api_keys" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "api_keys_update" ON "public"."api_keys" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."api_secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_secrets_deny_anon_modify" ON "public"."api_secrets" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."apollo_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_read" ON "public"."audit_log" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."cadence_enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cadence_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cadences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cadences_org_delete" ON "public"."cadences" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "cadences_org_insert" ON "public"."cadences" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "cadences_org_read" ON "public"."cadences" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "cadences_org_update" ON "public"."cadences" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."calendar_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_own_delete" ON "public"."calendar_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "calendar_own_insert" ON "public"."calendar_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "calendar_own_read" ON "public"."calendar_connections" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "calendar_own_update" ON "public"."calendar_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."call_daily_targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_daily_targets_delete" ON "public"."call_daily_targets" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "call_daily_targets_insert" ON "public"."call_daily_targets" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "call_daily_targets_select" ON "public"."call_daily_targets" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "call_daily_targets_update" ON "public"."call_daily_targets" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."call_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_feedback_insert" ON "public"."call_feedback" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."calls" "c"
     JOIN "public"."organization_members" "om" ON (("c"."org_id" = "om"."org_id")))
  WHERE (("c"."id" = "call_feedback"."call_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("om"."status" = 'active'::"public"."member_status")))));



CREATE POLICY "call_feedback_select" ON "public"."call_feedback" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."calls" "c"
     JOIN "public"."organization_members" "om" ON (("c"."org_id" = "om"."org_id")))
  WHERE (("c"."id" = "call_feedback"."call_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("om"."status" = 'active'::"public"."member_status")))));



ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calls_dedupe_backup_20260517" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calls_delete" ON "public"."calls" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."calls_ghost_backup_20260517" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calls_guilherme_extra_backup_20260517" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calls_insert" ON "public"."calls" FOR INSERT WITH CHECK (("org_id" = ( SELECT "organization_members"."org_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("organization_members"."status" = 'active'::"public"."member_status"))
 LIMIT 1)));



ALTER TABLE "public"."calls_refined_backup_20260517" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calls_select" ON "public"."calls" FOR SELECT USING (("org_id" = ( SELECT "organization_members"."org_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("organization_members"."status" = 'active'::"public"."member_status"))
 LIMIT 1)));



CREATE POLICY "calls_update" ON "public"."calls" FOR UPDATE USING (("org_id" = ( SELECT "organization_members"."org_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("organization_members"."status" = 'active'::"public"."member_status"))
 LIMIT 1)));



CREATE POLICY "cfr_org_read" ON "public"."closer_feedback_requests" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."closer_feedback_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."closers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "closers_org_delete" ON "public"."closers" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "closers_org_insert" ON "public"."closers" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "closers_org_read" ON "public"."closers" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "closers_org_update" ON "public"."closers" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."crm_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crm_manager_delete" ON "public"."crm_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "crm_manager_insert" ON "public"."crm_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "crm_manager_update" ON "public"."crm_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "crm_org_read" ON "public"."crm_connections" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."crm_sync_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crm_sync_log_read" ON "public"."crm_sync_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."crm_connections"
  WHERE (("crm_connections"."id" = "crm_sync_log"."connection_id") AND ("crm_connections"."org_id" = "public"."user_org_id"()) AND "public"."is_manager"()))));



ALTER TABLE "public"."custom_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_fields_delete" ON "public"."custom_fields" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "custom_fields_insert" ON "public"."custom_fields" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "custom_fields_select" ON "public"."custom_fields" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "custom_fields_update" ON "public"."custom_fields" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."daily_activity_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_goals_manager_delete" ON "public"."daily_activity_goals" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "daily_goals_manager_insert" ON "public"."daily_activity_goals" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "daily_goals_manager_update" ON "public"."daily_activity_goals" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "daily_goals_org_read" ON "public"."daily_activity_goals" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."email_blacklist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_blacklist_delete" ON "public"."email_blacklist" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "email_blacklist_insert" ON "public"."email_blacklist" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "email_blacklist_select" ON "public"."email_blacklist" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."enrichment_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrichment_attempts_org_insert" ON "public"."enrichment_attempts" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leads"
  WHERE (("leads"."id" = "enrichment_attempts"."lead_id") AND ("leads"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "enrichment_attempts_via_lead" ON "public"."enrichment_attempts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leads"
  WHERE (("leads"."id" = "enrichment_attempts"."lead_id") AND ("leads"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "enrollments_org_delete" ON "public"."cadence_enrollments" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "enrollments_org_insert" ON "public"."cadence_enrollments" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "enrollments_org_read" ON "public"."cadence_enrollments" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "enrollments_org_update" ON "public"."cadence_enrollments" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."fit_score_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fit_score_rules_delete_manager" ON "public"."fit_score_rules" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "fit_score_rules_insert_manager" ON "public"."fit_score_rules" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "fit_score_rules_select_own_org" ON "public"."fit_score_rules" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "fit_score_rules_update_manager" ON "public"."fit_score_rules" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."gmail_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gmail_own_delete" ON "public"."gmail_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "gmail_own_insert" ON "public"."gmail_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "gmail_own_read" ON "public"."gmail_connections" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "gmail_own_update" ON "public"."gmail_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_org_delete" ON "public"."goals" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "goals_org_insert" ON "public"."goals" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "goals_org_select" ON "public"."goals" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "goals_org_update" ON "public"."goals" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."goals_per_user" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_per_user_org_delete" ON "public"."goals_per_user" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "goals_per_user_org_insert" ON "public"."goals_per_user" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "goals_per_user_org_select" ON "public"."goals_per_user" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "goals_per_user_org_update" ON "public"."goals_per_user" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "import_errors_insert" ON "public"."lead_import_errors" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."lead_imports"
  WHERE (("lead_imports"."id" = "lead_import_errors"."import_id") AND ("lead_imports"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "import_errors_via_import" ON "public"."lead_import_errors" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."lead_imports"
  WHERE (("lead_imports"."id" = "lead_import_errors"."import_id") AND ("lead_imports"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "imports_org_insert" ON "public"."lead_imports" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "imports_org_read" ON "public"."lead_imports" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."interactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "interactions_org_delete" ON "public"."interactions" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "interactions_org_insert" ON "public"."interactions" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "interactions_org_read" ON "public"."interactions" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "interactions_org_update" ON "public"."interactions" FOR UPDATE USING (("org_id" = "public"."user_org_id"())) WITH CHECK (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."ldr_empresas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ldr_pipeline_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ldr_socios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_import_errors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_org_delete" ON "public"."leads" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "leads_org_insert" ON "public"."leads" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "leads_org_read" ON "public"."leads" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND ("public"."is_manager"() OR ("public"."lead_visibility_mode"() = 'all'::"text") OR (("public"."lead_visibility_mode"() = ANY (ARRAY['own'::"text", 'team'::"text"])) AND ("assigned_to" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "leads_org_update" ON "public"."leads" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND ("public"."is_manager"() OR ("public"."lead_visibility_mode"() = 'all'::"text") OR (("public"."lead_visibility_mode"() = ANY (ARRAY['own'::"text", 'team'::"text"])) AND ("assigned_to" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."loss_reasons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loss_reasons_delete_own_org" ON "public"."loss_reasons" FOR DELETE USING ((("public"."user_org_id"() = "org_id") AND ("is_system" = false)));



CREATE POLICY "loss_reasons_insert_own_org" ON "public"."loss_reasons" FOR INSERT WITH CHECK (("public"."user_org_id"() = "org_id"));



CREATE POLICY "loss_reasons_select_own_org" ON "public"."loss_reasons" FOR SELECT USING (("public"."user_org_id"() = "org_id"));



CREATE POLICY "loss_reasons_update_own_org" ON "public"."loss_reasons" FOR UPDATE USING (("public"."user_org_id"() = "org_id"));



CREATE POLICY "managers can delete apollo connections" ON "public"."apollo_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "managers can insert apollo connections" ON "public"."apollo_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "managers can update apollo connections" ON "public"."apollo_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"())) WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "members can read apollo connections" ON "public"."apollo_connections" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "members_manager_delete" ON "public"."organization_members" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "members_manager_insert" ON "public"."organization_members" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "members_manager_update" ON "public"."organization_members" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "members_org_read" ON "public"."organization_members" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete_own" ON "public"."notifications" FOR DELETE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = "public"."user_org_id"())));



CREATE POLICY "org_call_settings_delete" ON "public"."organization_call_settings" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "org_call_settings_insert" ON "public"."organization_call_settings" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "org_call_settings_select" ON "public"."organization_call_settings" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "org_call_settings_update" ON "public"."organization_call_settings" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "org_member_read" ON "public"."organizations" FOR SELECT USING (("id" = "public"."user_org_id"()));



CREATE POLICY "org_owner_update" ON "public"."organizations" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."organization_call_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phone_blacklist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phone_blacklist_delete" ON "public"."phone_blacklist" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "phone_blacklist_insert" ON "public"."phone_blacklist" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "phone_blacklist_select" ON "public"."phone_blacklist" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "phone_blacklist_update" ON "public"."phone_blacklist" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans_public_read" ON "public"."plans" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."provider_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provider_events_org_read" ON "public"."provider_events" FOR SELECT USING ((("org_id" IS NULL) OR ("org_id" = "public"."user_org_id"())));



ALTER TABLE "public"."scheduled_activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scheduled_activities_org_delete" ON "public"."scheduled_activities" FOR DELETE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "service_role_only" ON "public"."ldr_empresas" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service_role_only" ON "public"."ldr_pipeline_log" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service_role_only" ON "public"."ldr_socios" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



ALTER TABLE "public"."standard_field_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "steps_via_cadence_delete" ON "public"."cadence_steps" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."cadences"
  WHERE (("cadences"."id" = "cadence_steps"."cadence_id") AND ("cadences"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "steps_via_cadence_insert" ON "public"."cadence_steps" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cadences"
  WHERE (("cadences"."id" = "cadence_steps"."cadence_id") AND ("cadences"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "steps_via_cadence_read" ON "public"."cadence_steps" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cadences"
  WHERE (("cadences"."id" = "cadence_steps"."cadence_id") AND ("cadences"."org_id" = "public"."user_org_id"())))));



CREATE POLICY "steps_via_cadence_update" ON "public"."cadence_steps" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cadences"
  WHERE (("cadences"."id" = "cadence_steps"."cadence_id") AND ("cadences"."org_id" = "public"."user_org_id"())))));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_org_read" ON "public"."subscriptions" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "templates_org_delete" ON "public"."message_templates" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND ("is_system" = false)));



CREATE POLICY "templates_org_insert" ON "public"."message_templates" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "templates_org_read" ON "public"."message_templates" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "templates_org_update" ON "public"."message_templates" FOR UPDATE USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "users_read_own_notifications" ON "public"."notifications" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = "public"."user_org_id"())));



CREATE POLICY "users_update_own_notifications" ON "public"."notifications" FOR UPDATE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = "public"."user_org_id"())));



CREATE POLICY "wa_credits_org_insert" ON "public"."whatsapp_credits" FOR INSERT WITH CHECK (("org_id" = "public"."user_org_id"()));



CREATE POLICY "wa_credits_org_read" ON "public"."whatsapp_credits" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "wa_credits_org_update" ON "public"."whatsapp_credits" FOR UPDATE USING (("org_id" = "public"."user_org_id"())) WITH CHECK (("org_id" = "public"."user_org_id"()));



ALTER TABLE "public"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_endpoints_delete" ON "public"."webhook_endpoints" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "webhook_endpoints_insert" ON "public"."webhook_endpoints" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "webhook_endpoints_select" ON "public"."webhook_endpoints" FOR SELECT USING (("org_id" = "public"."user_org_id"()));



CREATE POLICY "webhook_endpoints_update" ON "public"."webhook_endpoints" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_events_org_read" ON "public"."webhook_events" FOR SELECT USING ((("org_id" IS NULL) OR ("org_id" = "public"."user_org_id"())));



ALTER TABLE "public"."whatsapp_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_instances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_manager_delete" ON "public"."whatsapp_connections" FOR DELETE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "whatsapp_manager_insert" ON "public"."whatsapp_connections" FOR INSERT WITH CHECK ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "whatsapp_manager_read" ON "public"."whatsapp_connections" FOR SELECT USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



CREATE POLICY "whatsapp_manager_update" ON "public"."whatsapp_connections" FOR UPDATE USING ((("org_id" = "public"."user_org_id"()) AND "public"."is_manager"()));



ALTER TABLE "public"."worker_run_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "worker_run_state_select_authenticated" ON "public"."worker_run_state" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."calls";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."interactions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organization_members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organizations";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




































































































































































































































REVOKE ALL ON FUNCTION "public"."audit_lead_lifecycle_direct_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_lead_lifecycle_direct_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_enroll_ldr_autonomo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_enroll_ldr_autonomo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_fill_decisor_from_socios"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_fill_decisor_from_socios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_fill_decisor_from_socios"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_fill_segmento"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_fill_segmento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_fill_segmento"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_fill_website"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_fill_website"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_fill_website"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_skip_ineligible_call_transcription"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_skip_ineligible_call_transcription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_skip_ineligible_call_transcription"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."buscar_decisor_empresa"("p_empresa_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."buscar_decisor_empresa"("p_empresa_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."buscar_empresa_validada_para_distribuir"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."buscar_empresa_validada_para_distribuir"() TO "service_role";



GRANT ALL ON FUNCTION "public"."buscar_proximo_decisor_para_ligar"() TO "anon";
GRANT ALL ON FUNCTION "public"."buscar_proximo_decisor_para_ligar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."buscar_proximo_decisor_para_ligar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_engagement_score"("p_lead_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_engagement_score"("p_lead_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_engagement_score"("p_lead_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_next_step_due"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_next_step_due"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_next_step_due"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."calculate_tier_from_faixa"("faixa_input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_tier_from_faturamento"("faturamento_reais" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_provider_events"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_provider_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."close_enrollments_on_terminal_lead"() TO "anon";
GRANT ALL ON FUNCTION "public"."close_enrollments_on_terminal_lead"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_enrollments_on_terminal_lead"() TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_enrollments_on_cadence_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."complete_enrollments_on_cadence_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_enrollments_on_cadence_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_activities_by_performer"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_activities_by_performer"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_leads_by_status"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_leads_by_status"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_leads_by_status"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_leads_opened_by_sdr"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_leads_opened_by_sdr"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_leads_opened_by_sdr"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_leads_opened_by_sdr_daily"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_leads_opened_by_sdr_daily"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_leads_opened_by_sdr_daily"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_cadence_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."derive_segmento"("cnae" "text", "razao" "text", "fantasia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."derive_segmento"("cnae" "text", "razao" "text", "fantasia" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."derive_segmento"("cnae" "text", "razao" "text", "fantasia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."derive_segmento_from_cnae"("cnae_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."derive_segmento_from_cnae"("cnae_input" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."derive_segmento_from_cnae"("cnae_input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."derive_segmento_from_nome"("razao" "text", "fantasia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."derive_segmento_from_nome"("razao" "text", "fantasia" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."derive_segmento_from_nome"("razao" "text", "fantasia" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."effective_due_brt"("ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."effective_due_brt"("ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."effective_due_brt"("ts" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."extract_website_from_email"("email_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."extract_website_from_email"("email_input" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."extract_website_from_email"("email_input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fetch_conversion_ranking_data"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fetch_conversion_ranking_data"("p_org_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fetch_inactive_enrollment_candidates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fetch_inactive_enrollment_candidates"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fetch_overdue_manual_activities"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fetch_overdue_manual_activities"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_lead_id_by_phone"("p_org_id" "uuid", "p_phone_digits" "text", "p_sdr_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_lead_id_by_phone"("p_org_id" "uuid", "p_phone_digits" "text", "p_sdr_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gerar_nome_curto"("p_razao_social" "text", "p_nome_fantasia" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."gerar_nome_curto"("p_razao_social" "text", "p_nome_fantasia" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gerar_nome_curto"("p_razao_social" "text", "p_nome_fantasia" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."gerar_nome_curto_socio"("p_nome_completo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."gerar_nome_curto_socio"("p_nome_completo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gerar_nome_curto_socio"("p_nome_completo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_calls_for_v4sales"("p_year" integer, "p_month" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_calls_for_v4sales"("p_year" integer, "p_month" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_calls_for_v4sales"("p_from_date" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_calls_for_v4sales"("p_from_date" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_calls_for_v4sales"("p_from_date" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_distinct_lead_canais"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_distinct_lead_canais"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_lead_canais"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_distinct_lead_cnaes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_distinct_lead_cnaes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_lead_cnaes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_executed_steps"("p_cadence_ids" "uuid"[], "p_step_ids" "uuid"[], "p_lead_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_executed_steps"("p_cadence_ids" "uuid"[], "p_step_ids" "uuid"[], "p_lead_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_executed_steps"("p_cadence_ids" "uuid"[], "p_step_ids" "uuid"[], "p_lead_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_indicacoes_leads_lookup"("p_api_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_indicacoes_leads_lookup"("p_api_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_indicacoes_leads_lookup"("p_api_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_indicacoes_ranking"("p_year" integer, "p_month" integer, "p_api_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_leads_for_v4sales"("p_api_token" "text", "p_from_date" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_manager"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lead_visibility_mode"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lead_visibility_mode"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lead_visibility_mode"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."leads_without_active_enrollment"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leads_without_active_enrollment"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."list_overdue_enrollments_brt"("p_org_id" "uuid", "p_cutoff" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."list_overdue_enrollments_brt"("p_org_id" "uuid", "p_cutoff" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_overdue_enrollments_brt"("p_org_id" "uuid", "p_cutoff" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_empresa_distribuida"("p_empresa_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_empresa_distribuida"("p_empresa_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."processar_resultado_ligacao"("p_call_id" "text", "p_call_status" "text", "p_disconnection_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."processar_resultado_ligacao"("p_call_id" "text", "p_call_status" "text", "p_disconnection_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."push_calls_to_v4sales"("p_year" integer, "p_month" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_calls_to_v4sales"("p_year" integer, "p_month" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalc_engagement_score"("p_lead_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalc_engagement_score"("p_lead_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_tentativa_ligacao"("p_socio_id" "uuid", "p_empresa_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_tentativa_ligacao"("p_socio_id" "uuid", "p_empresa_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_tentativa_ligacao"("p_socio_id" "uuid", "p_empresa_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_qualified_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_qualified_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_qualified_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_tier_from_broker"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_tier_from_broker"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tier_from_broker"() TO "service_role";



GRANT ALL ON FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."skip_weekend_brt"("ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_nome_curto"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_nome_curto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_nome_curto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_nome_curto_socio"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_nome_curto_socio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_nome_curto_socio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trigger_recalc_engagement_score"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trigger_recalc_engagement_score"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_call_from_webhook"("p_api4com_call_id" "text", "p_record_url" "text", "p_duration" integer, "p_started_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_call_from_webhook"("p_api4com_call_id" "text", "p_record_url" "text", "p_duration" integer, "p_started_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_socio_lemit"("p_empresa_id" "text", "p_cnpj" "text", "p_nome_socio" "text", "p_posicao" integer, "p_eh_pj" boolean, "p_telefone" "text", "p_email" "text", "p_whatsapp" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_socio_lemit"("p_empresa_id" "text", "p_cnpj" "text", "p_nome_socio" "text", "p_posicao" integer, "p_eh_pj" boolean, "p_telefone" "text", "p_email" "text", "p_whatsapp" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_org_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_org_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_api_secret"("p_name" "text", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_api_secret"("p_name" "text", "p_token" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."activity_templates" TO "anon";
GRANT ALL ON TABLE "public"."activity_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_templates" TO "service_role";



GRANT ALL ON TABLE "public"."ai_usage" TO "anon";
GRANT ALL ON TABLE "public"."ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage" TO "service_role";



GRANT ALL ON TABLE "public"."api4com_connections" TO "anon";
GRANT ALL ON TABLE "public"."api4com_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."api4com_connections" TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."api_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."apollo_connections" TO "anon";
GRANT ALL ON TABLE "public"."apollo_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."apollo_connections" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."cadence_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."cadence_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."cadence_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."cadence_steps" TO "anon";
GRANT ALL ON TABLE "public"."cadence_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."cadence_steps" TO "service_role";



GRANT ALL ON TABLE "public"."cadences" TO "anon";
GRANT ALL ON TABLE "public"."cadences" TO "authenticated";
GRANT ALL ON TABLE "public"."cadences" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_connections" TO "anon";
GRANT ALL ON TABLE "public"."calendar_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_connections" TO "service_role";



GRANT ALL ON TABLE "public"."call_daily_targets" TO "anon";
GRANT ALL ON TABLE "public"."call_daily_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."call_daily_targets" TO "service_role";



GRANT ALL ON TABLE "public"."call_feedback" TO "anon";
GRANT ALL ON TABLE "public"."call_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."call_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."calls" TO "anon";
GRANT ALL ON TABLE "public"."calls" TO "authenticated";
GRANT ALL ON TABLE "public"."calls" TO "service_role";



GRANT ALL ON TABLE "public"."calls_dedupe_backup_20260517" TO "anon";
GRANT ALL ON TABLE "public"."calls_dedupe_backup_20260517" TO "authenticated";
GRANT ALL ON TABLE "public"."calls_dedupe_backup_20260517" TO "service_role";



GRANT ALL ON TABLE "public"."calls_ghost_backup_20260517" TO "anon";
GRANT ALL ON TABLE "public"."calls_ghost_backup_20260517" TO "authenticated";
GRANT ALL ON TABLE "public"."calls_ghost_backup_20260517" TO "service_role";



GRANT ALL ON TABLE "public"."calls_guilherme_extra_backup_20260517" TO "anon";
GRANT ALL ON TABLE "public"."calls_guilherme_extra_backup_20260517" TO "authenticated";
GRANT ALL ON TABLE "public"."calls_guilherme_extra_backup_20260517" TO "service_role";



GRANT ALL ON TABLE "public"."calls_refined_backup_20260517" TO "anon";
GRANT ALL ON TABLE "public"."calls_refined_backup_20260517" TO "authenticated";
GRANT ALL ON TABLE "public"."calls_refined_backup_20260517" TO "service_role";



GRANT ALL ON TABLE "public"."closer_feedback_requests" TO "anon";
GRANT ALL ON TABLE "public"."closer_feedback_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."closer_feedback_requests" TO "service_role";



GRANT ALL ON TABLE "public"."closers" TO "anon";
GRANT ALL ON TABLE "public"."closers" TO "authenticated";
GRANT ALL ON TABLE "public"."closers" TO "service_role";



GRANT ALL ON TABLE "public"."crm_connections" TO "anon";
GRANT ALL ON TABLE "public"."crm_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_connections" TO "service_role";



GRANT ALL ON TABLE "public"."crm_sync_log" TO "anon";
GRANT ALL ON TABLE "public"."crm_sync_log" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_sync_log" TO "service_role";



GRANT ALL ON TABLE "public"."custom_fields" TO "anon";
GRANT ALL ON TABLE "public"."custom_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_fields" TO "service_role";



GRANT ALL ON TABLE "public"."daily_activity_goals" TO "anon";
GRANT ALL ON TABLE "public"."daily_activity_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_activity_goals" TO "service_role";



GRANT ALL ON TABLE "public"."email_blacklist" TO "anon";
GRANT ALL ON TABLE "public"."email_blacklist" TO "authenticated";
GRANT ALL ON TABLE "public"."email_blacklist" TO "service_role";



GRANT ALL ON TABLE "public"."enrichment_attempts" TO "anon";
GRANT ALL ON TABLE "public"."enrichment_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."enrichment_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."fit_score_rules" TO "anon";
GRANT ALL ON TABLE "public"."fit_score_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."fit_score_rules" TO "service_role";



GRANT ALL ON TABLE "public"."gmail_connections" TO "anon";
GRANT ALL ON TABLE "public"."gmail_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."gmail_connections" TO "service_role";



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."goals_per_user" TO "anon";
GRANT ALL ON TABLE "public"."goals_per_user" TO "authenticated";
GRANT ALL ON TABLE "public"."goals_per_user" TO "service_role";



GRANT ALL ON TABLE "public"."interactions" TO "anon";
GRANT ALL ON TABLE "public"."interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."interactions" TO "service_role";



GRANT ALL ON TABLE "public"."ldr_empresas" TO "anon";
GRANT ALL ON TABLE "public"."ldr_empresas" TO "authenticated";
GRANT ALL ON TABLE "public"."ldr_empresas" TO "service_role";



GRANT ALL ON TABLE "public"."ldr_pipeline_log" TO "anon";
GRANT ALL ON TABLE "public"."ldr_pipeline_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ldr_pipeline_log" TO "service_role";



GRANT ALL ON TABLE "public"."ldr_socios" TO "anon";
GRANT ALL ON TABLE "public"."ldr_socios" TO "authenticated";
GRANT ALL ON TABLE "public"."ldr_socios" TO "service_role";



GRANT ALL ON TABLE "public"."lead_import_errors" TO "anon";
GRANT ALL ON TABLE "public"."lead_import_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_import_errors" TO "service_role";



GRANT ALL ON TABLE "public"."lead_imports" TO "anon";
GRANT ALL ON TABLE "public"."lead_imports" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_imports" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."leads_no_active_enrollment" TO "anon";
GRANT ALL ON TABLE "public"."leads_no_active_enrollment" TO "authenticated";
GRANT ALL ON TABLE "public"."leads_no_active_enrollment" TO "service_role";



GRANT ALL ON TABLE "public"."loss_reasons" TO "anon";
GRANT ALL ON TABLE "public"."loss_reasons" TO "authenticated";
GRANT ALL ON TABLE "public"."loss_reasons" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."org_members" TO "service_role";



GRANT ALL ON TABLE "public"."organization_call_settings" TO "anon";
GRANT ALL ON TABLE "public"."organization_call_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_call_settings" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."phone_blacklist" TO "anon";
GRANT ALL ON TABLE "public"."phone_blacklist" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_blacklist" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "anon";
GRANT ALL ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."provider_events" TO "anon";
GRANT ALL ON TABLE "public"."provider_events" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_events" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_activities" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_activities" TO "service_role";



GRANT ALL ON TABLE "public"."standard_field_settings" TO "anon";
GRANT ALL ON TABLE "public"."standard_field_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."standard_field_settings" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_dashboard" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_dashboard_full" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_para_avaliar_ia" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_para_enriquecer" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_para_validar_tel" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ldr_validados" TO "service_role";



GRANT ALL ON TABLE "public"."vw_proxima_empresa_enriquecer" TO "service_role";



GRANT ALL ON TABLE "public"."vw_proximo_decisor_para_ligar" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_endpoints" TO "anon";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_connections" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_connections" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_credits" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_credits" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_instances" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_instances" TO "service_role";



GRANT ALL ON TABLE "public"."worker_run_state" TO "anon";
GRANT ALL ON TABLE "public"."worker_run_state" TO "authenticated";
GRANT ALL ON TABLE "public"."worker_run_state" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































-- ==================================================================
-- Objetos não capturados pelo 'db dump' padrão:
--   - policies do schema storage (avatars, org-logos)
--   - trigger on_auth_user_created em auth.users (signup → org/perfil)
--   - recreate da policy api_secrets_deny_anon_modify (formatação)
-- Crons (24 jobs pg_cron) NÃO versionados: config de infra com CRON_SECRET.
-- db diff residual = 3 views LDR (ruído cosmético de formatação, schema fiel).
-- ==================================================================
drop policy "api_secrets_deny_anon_modify" on "public"."api_secrets";

revoke delete on table "public"."api_secrets" from "anon";

revoke insert on table "public"."api_secrets" from "anon";

revoke references on table "public"."api_secrets" from "anon";

revoke select on table "public"."api_secrets" from "anon";

revoke trigger on table "public"."api_secrets" from "anon";

revoke truncate on table "public"."api_secrets" from "anon";

revoke update on table "public"."api_secrets" from "anon";

revoke delete on table "public"."api_secrets" from "authenticated";

revoke insert on table "public"."api_secrets" from "authenticated";

revoke references on table "public"."api_secrets" from "authenticated";

revoke select on table "public"."api_secrets" from "authenticated";

revoke trigger on table "public"."api_secrets" from "authenticated";

revoke truncate on table "public"."api_secrets" from "authenticated";

revoke update on table "public"."api_secrets" from "authenticated";

create or replace view "public"."vw_ldr_dashboard_full" as  SELECT json_build_object('updated_at', now(), 'pipeline', json_build_object('total', ( SELECT count(*) AS count
           FROM public.ldr_empresas), 'pendentes', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'pendente'::text)), 'processados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text <> 'pendente'::text)), 'aprovados_icp', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (((ldr_empresas.status_ldr)::text = ANY ((ARRAY['aprovado_icp'::character varying, 'validando_tel'::character varying, 'validado'::character varying, 'distribuido'::character varying, 'descartado'::character varying])::text[])) AND (ldr_empresas.score_icp_ia IS NOT NULL))), 'validados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = ANY ((ARRAY['validado'::character varying, 'distribuido'::character varying])::text[]))), 'distribuidos', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'distribuido'::text)), 'atual_enriquecido', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'enriquecido'::text)), 'atual_aprovado_icp', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'aprovado_icp'::text)), 'atual_validando_tel', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'validando_tel'::text)), 'atual_validado', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'validado'::text)), 'atual_distribuido', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'distribuido'::text)), 'atual_descartado', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.status_ldr)::text = 'descartado'::text))), 'prioridades', json_build_object('quentes_total', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.prioridade)::text = '🔥 QUENTE'::text)), 'quentes_processados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (((ldr_empresas.prioridade)::text = '🔥 QUENTE'::text) AND ((ldr_empresas.status_ldr)::text <> 'pendente'::text))), 'morno_quentes_total', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.prioridade)::text = '🟠 MORNO-QUENTE'::text)), 'morno_quentes_processados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (((ldr_empresas.prioridade)::text = '🟠 MORNO-QUENTE'::text) AND ((ldr_empresas.status_ldr)::text <> 'pendente'::text))), 'mornos_total', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.prioridade)::text = '🟡 MORNO'::text)), 'mornos_processados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (((ldr_empresas.prioridade)::text = '🟡 MORNO'::text) AND ((ldr_empresas.status_ldr)::text <> 'pendente'::text))), 'frios_total', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.prioridade)::text = '🔵 FRIO'::text)), 'frios_processados', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (((ldr_empresas.prioridade)::text = '🔵 FRIO'::text) AND ((ldr_empresas.status_ldr)::text <> 'pendente'::text)))), 'ligacoes', json_build_object('disparadas', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE ((ldr_pipeline_log.acao)::text = 'ligacao_disparada'::text)), 'resultados', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes)::text <> '"placeholder"'::text))), 'atendidas', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'call_status'::text) = 'ended'::text))), 'nao_atendidas', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'call_status'::text) = 'not_connected'::text))), 'voicemail', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'disconnection_reason'::text) = 'voicemail_reached'::text))), 'user_hangup', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'disconnection_reason'::text) = 'user_hangup'::text))), 'max_duration', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'disconnection_reason'::text) = 'max_duration_reached'::text))), 'no_answer', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'disconnection_reason'::text) = 'dial_no_answer'::text))), 'agent_hangup', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE (((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text) AND ((ldr_pipeline_log.detalhes ->> 'disconnection_reason'::text) = 'agent_hangup'::text)))), 'icp_scores', json_build_object('score_9', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (ldr_empresas.score_icp_ia = 9)), 'score_8', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (ldr_empresas.score_icp_ia = 8)), 'score_7', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (ldr_empresas.score_icp_ia = 7)), 'score_6', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE (ldr_empresas.score_icp_ia = 6)), 'score_lte5', ( SELECT count(*) AS count
           FROM public.ldr_empresas
          WHERE ((ldr_empresas.score_icp_ia IS NOT NULL) AND (ldr_empresas.score_icp_ia <= 5))), 'total_avaliados', ( SELECT count(*) AS count
           FROM public.ldr_pipeline_log
          WHERE ((ldr_pipeline_log.acao)::text = 'avaliado_ia'::text))), 'socios', json_build_object('total', ( SELECT count(*) AS count
           FROM public.ldr_socios), 'com_telefone', ( SELECT count(*) AS count
           FROM public.ldr_socios
          WHERE (ldr_socios.telefone_lemit IS NOT NULL)), 'decisores', ( SELECT count(*) AS count
           FROM public.ldr_socios
          WHERE (ldr_socios.eh_decisor_provavel = true)), 'decisores_com_tel', ( SELECT count(*) AS count
           FROM public.ldr_socios
          WHERE ((ldr_socios.eh_decisor_provavel = true) AND (ldr_socios.telefone_lemit IS NOT NULL))), 'decisores_disponiveis', ( SELECT count(*) AS count
           FROM (public.ldr_socios s
             JOIN public.ldr_empresas e ON ((s.empresa_id = e.id)))
          WHERE ((s.eh_decisor_provavel = true) AND (s.telefone_lemit IS NOT NULL) AND ((s.telefone_lemit)::text <> ''::text) AND ((e.status_ldr)::text = 'aprovado_icp'::text) AND ((s.status_validacao)::text = ANY ((ARRAY['pendente'::character varying, 'tentando'::character varying])::text[])) AND (s.tentativas_ligacao < 3) AND ((s.ultima_ligacao_at IS NULL) OR (s.ultima_ligacao_at < (now() - '24:00:00'::interval)))))), 'cadencia_isp', json_build_object('enrolled', ( SELECT count(*) AS count
           FROM public.cadence_enrollments
          WHERE (cadence_enrollments.cadence_id = '896ce318-1c1a-4c3f-8f55-5646404f1023'::uuid)), 'active', ( SELECT count(*) AS count
           FROM public.cadence_enrollments
          WHERE ((cadence_enrollments.cadence_id = '896ce318-1c1a-4c3f-8f55-5646404f1023'::uuid) AND (cadence_enrollments.status = 'active'::public.enrollment_status))), 'completed', ( SELECT count(*) AS count
           FROM public.cadence_enrollments
          WHERE ((cadence_enrollments.cadence_id = '896ce318-1c1a-4c3f-8f55-5646404f1023'::uuid) AND (cadence_enrollments.status = 'completed'::public.enrollment_status)))), 'volume_diario', ( SELECT json_agg(row_to_json(d.*)) AS json_agg
           FROM ( SELECT date(ldr_pipeline_log.created_at) AS dia,
                    count(*) FILTER (WHERE ((ldr_pipeline_log.acao)::text = 'avaliado_ia'::text)) AS avaliacoes,
                    count(*) FILTER (WHERE ((ldr_pipeline_log.acao)::text = 'ligacao_disparada'::text)) AS ligacoes,
                    count(*) FILTER (WHERE ((ldr_pipeline_log.acao)::text = 'ligacao_resultado'::text)) AS resultados
                   FROM public.ldr_pipeline_log
                  GROUP BY (date(ldr_pipeline_log.created_at))
                  ORDER BY (date(ldr_pipeline_log.created_at))) d), 'primeiro_dia', ( SELECT min(date(ldr_pipeline_log.created_at)) AS min
           FROM public.ldr_pipeline_log), 'dias_operacao', ( SELECT ((CURRENT_DATE - min(date(ldr_pipeline_log.created_at))) + 1)
           FROM public.ldr_pipeline_log)) AS data;


create or replace view "public"."vw_ldr_para_validar_tel" as  SELECT s.id AS socio_id,
    s.nome_socio,
    s.telefone_lemit,
    s.telefone_score,
    s.telefone_ranking,
    e.id AS empresa_id,
    e.cnpj,
    e.razao_social,
    e.nome_fantasia,
    e.segmento,
    e.prioridade,
    e.score_icp_ia
   FROM (public.ldr_socios s
     JOIN public.ldr_empresas e ON ((s.empresa_id = e.id)))
  WHERE ((s.eh_decisor_provavel = true) AND (s.telefone_lemit IS NOT NULL) AND ((s.status_validacao)::text = ANY ((ARRAY['pendente'::character varying, 'retry_agendado'::character varying])::text[])) AND (s.tentativas_ligacao < s.max_tentativas) AND ((s.data_proxima_tentativa IS NULL) OR (s.data_proxima_tentativa <= now())))
  ORDER BY e.score_icp_ia DESC NULLS LAST, s.telefone_score DESC NULLS LAST;


create or replace view "public"."vw_proximo_decisor_para_ligar" as  SELECT s.id AS socio_id,
    COALESCE(s.nome_curto, s.nome_socio) AS nome_socio,
    (s.telefone_lemit)::text AS telefone_lemit,
    s.empresa_id,
    e.razao_social,
    e.nome_fantasia,
    e.nome_curto,
    e.score_icp_ia
   FROM (public.ldr_socios s
     JOIN public.ldr_empresas e ON ((s.empresa_id = e.id)))
  WHERE ((s.eh_decisor_provavel = true) AND (s.telefone_lemit IS NOT NULL) AND ((s.telefone_lemit)::text <> ''::text) AND ((e.status_ldr)::text = 'aprovado_icp'::text) AND ((s.status_validacao)::text = ANY ((ARRAY['pendente'::character varying, 'tentando'::character varying])::text[])) AND (s.tentativas_ligacao < 5) AND ((s.ultima_ligacao_at IS NULL) OR (s.ultima_ligacao_at < (now() - '04:00:00'::interval))))
  ORDER BY s.tentativas_ligacao, e.score_icp_ia DESC NULLS LAST
 LIMIT 1;



  create policy "api_secrets_deny_anon_modify"
  on "public"."api_secrets"
  as permissive
  for all
  to anon, authenticated
using (false)
with check (false);


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Anyone can read avatars"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Org members can delete logo"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'org-logos'::text) AND ((storage.foldername(name))[1] = (public.user_org_id())::text)));



  create policy "Org members can update logo"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'org-logos'::text) AND ((storage.foldername(name))[1] = (public.user_org_id())::text)));



  create policy "Org members can upload logo"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'org-logos'::text) AND ((storage.foldername(name))[1] = (public.user_org_id())::text)));



  create policy "Org members list own logos"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'org-logos'::text) AND ((storage.foldername(name))[1] = (public.user_org_id())::text)));



  create policy "Users can delete own avatar"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can update own avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can upload own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));





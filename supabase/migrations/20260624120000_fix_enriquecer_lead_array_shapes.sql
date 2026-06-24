-- Fix enriquecer_lead RPC writing JSONB arrays as bare strings.
--
-- The enrichment automation (n8n "Enriquecimento LDR (Apify)" → RPC
-- enriquecer_lead) appended phones/emails/socios using `to_jsonb(text)` /
-- raw name arrays, producing arrays of *strings* (e.g. phones = ["+55 19 ..."])
-- instead of the structured objects the app expects:
--   phones  → [{ tipo, numero }]
--   emails  → [{ tipo, email }]
--   socios  → [{ nome, ... }]
--
-- The string shape crashed the lead detail page with
-- "Cannot read properties of undefined (reading 'replace')" (normalizePhone
-- received `phone.numero` === undefined off a string element).
--
-- This migration:
--   1. Redefines enriquecer_lead to write structured objects.
--   2. Backfills any existing leads whose phones/emails/socios still hold
--      string elements (idempotent — only touches string entries).

BEGIN;

CREATE OR REPLACE FUNCTION public.enriquecer_lead(p_lead_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone  text := NULLIF(NULLIF(p_data->>'telefone',''),'não identificado');
  v_dphone text := NULLIF(NULLIF(p_data->>'decisor_telefone',''),'não identificado');
  v_email  text := NULLIF(NULLIF(p_data->>'decisor_email',''),'não identificado');
  v_nome   text := NULLIF(NULLIF(p_data->>'decisor_nome',''),'não identificado');
  v_first  text := NULLIF(split_part(COALESCE(v_nome,''),' ',1),'');
  v_last   text := NULLIF(regexp_replace(COALESCE(v_nome,''),'^\S+\s*',''),'');
BEGIN
  UPDATE public.leads SET
    instagram = COALESCE(NULLIF(instagram,''), NULLIF(NULLIF(p_data->>'instagram',''),'não identificado')),
    linkedin = COALESCE(NULLIF(linkedin,''), NULLIF(NULLIF(p_data->>'company_linkedin',''),'não identificado')),
    website = COALESCE(NULLIF(website,''), NULLIF(NULLIF(p_data->>'site',''),'não identificado')),
    first_name = COALESCE(NULLIF(first_name,''), v_first),
    last_name = COALESCE(NULLIF(last_name,''), v_last),
    job_title = COALESCE(NULLIF(job_title,''), NULLIF(NULLIF(p_data->>'decisor_cargo',''),'não identificado')),
    segmento = COALESCE(NULLIF(segmento,''), NULLIF(NULLIF(p_data->>'setor',''),'não identificado')),
    cnae = COALESCE(NULLIF(cnae,''), NULLIF(NULLIF(p_data->>'cnae',''),'não identificado')),
    porte = COALESCE(NULLIF(porte,''), NULLIF(NULLIF(p_data->>'porte',''),'não identificado')),
    razao_social = COALESCE(NULLIF(razao_social,''), NULLIF(NULLIF(p_data->>'razao_social',''),'não identificado')),
    situacao_cadastral = COALESCE(NULLIF(situacao_cadastral,''), NULLIF(NULLIF(p_data->>'situacao',''),'não identificado')),
    -- socios may arrive as an array of bare name strings — coerce each to { nome }.
    socios = CASE
      WHEN socios IS NULL OR jsonb_array_length(COALESCE(socios,'[]'::jsonb))=0
      THEN COALESCE((
        SELECT jsonb_agg(
          CASE WHEN jsonb_typeof(e.value)='string'
               THEN jsonb_build_object('nome', e.value #>> '{}')
               ELSE e.value END)
        FROM jsonb_array_elements(p_data->'socios') e
      ), socios)
      ELSE socios END,
    telefone = COALESCE(NULLIF(telefone,''), v_phone),
    email = COALESCE(NULLIF(email,''), v_email),
    enrichment_status='enriched', enriched_at=now(), updated_at=now()
  WHERE id = p_lead_id;

  -- Append company + decisor phones as structured { tipo, numero } objects,
  -- deduped by numero. Only when the lead has no structured phones yet
  -- (empty, or legacy string-form left over before backfill).
  UPDATE public.leads SET phones =
       COALESCE(phones,'[]'::jsonb)
    || CASE WHEN v_phone IS NOT NULL
              AND NOT (COALESCE(phones,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('numero', v_phone)))
            THEN jsonb_build_array(jsonb_build_object('tipo','fixo','numero', v_phone))
            ELSE '[]'::jsonb END
    || CASE WHEN v_dphone IS NOT NULL AND v_dphone IS DISTINCT FROM v_phone
              AND NOT (COALESCE(phones,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('numero', v_dphone)))
            THEN jsonb_build_array(jsonb_build_object('tipo','celular','numero', v_dphone))
            ELSE '[]'::jsonb END
   WHERE id = p_lead_id
     AND (jsonb_array_length(COALESCE(phones,'[]'::jsonb))=0 OR jsonb_typeof(phones->0)='string');

  UPDATE public.leads SET emails =
       COALESCE(emails,'[]'::jsonb)
    || CASE WHEN v_email IS NOT NULL
              AND NOT (COALESCE(emails,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('email', v_email)))
            THEN jsonb_build_array(jsonb_build_object('tipo','corporativo','email', v_email))
            ELSE '[]'::jsonb END
   WHERE id = p_lead_id AND v_email IS NOT NULL
     AND (jsonb_array_length(COALESCE(emails,'[]'::jsonb))=0 OR jsonb_typeof(emails->0)='string');
END; $function$;

-- ── Backfill existing corrupted rows ────────────────────────────────────────
UPDATE public.leads l SET phones = (
  SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value)='string'
                        THEN jsonb_build_object('tipo','fixo','numero', e.value #>> '{}')
                        ELSE e.value END)
  FROM jsonb_array_elements(l.phones) e)
WHERE l.phones IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.phones) e WHERE jsonb_typeof(e.value)='string');

UPDATE public.leads l SET emails = (
  SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value)='string'
                        THEN jsonb_build_object('tipo','corporativo','email', e.value #>> '{}')
                        ELSE e.value END)
  FROM jsonb_array_elements(l.emails) e)
WHERE l.emails IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.emails) e WHERE jsonb_typeof(e.value)='string');

UPDATE public.leads l SET socios = (
  SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value)='string'
                        THEN jsonb_build_object('nome', e.value #>> '{}')
                        ELSE e.value END)
  FROM jsonb_array_elements(l.socios) e)
WHERE l.socios IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.socios) e WHERE jsonb_typeof(e.value)='string');

COMMIT;

-- Registra um evento de histórico "Lead Enriquecido pela Automação" na timeline
-- (tabela interactions) toda vez que a automação n8n conclui o enriquecimento.
-- O INSERT é condicional: só na PRIMEIRA vez (quando o lead ainda não estava
-- enriched), para não duplicar caso a RPC seja reexecutada. performed_by fica
-- NULL → a UI (LeadTimeline) exibe o label de sistema em vez de um nome de SDR.
--
-- Preserva integralmente a lógica de enriquecimento existente; apenas adiciona
-- a captura do estado anterior e o INSERT do evento ao final.
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
  v_meta_url text := NULLIF(NULLIF(p_data->>'meta_ads_url',''),'não identificado');
  v_gads_url text := NULLIF(NULLIF(p_data->>'google_ads_url',''),'não identificado');
  v_cfv jsonb;
  v_org_id uuid;
  v_was_enriched boolean;
BEGIN
  -- Estado ANTES do update: usado para logar o evento só na 1ª vez.
  SELECT org_id, (enriched_at IS NOT NULL)
    INTO v_org_id, v_was_enriched
    FROM public.leads WHERE id = p_lead_id;

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
    socios = CASE WHEN socios IS NULL OR jsonb_array_length(COALESCE(socios,'[]'::jsonb))=0 THEN COALESCE(p_data->'socios', socios) ELSE socios END,
    telefone = COALESCE(NULLIF(telefone,''), v_phone),
    email = COALESCE(NULLIF(email,''), v_email),
    enrichment_status='enriched', enriched_at=now(), updated_at=now()
  WHERE id = p_lead_id;

  UPDATE public.leads SET phones = COALESCE(phones,'[]'::jsonb) || to_jsonb(v_phone)
   WHERE id=p_lead_id AND v_phone IS NOT NULL
     AND (jsonb_array_length(COALESCE(phones,'[]'::jsonb))=0 OR jsonb_typeof(phones->0)='string')
     AND NOT (COALESCE(phones,'[]'::jsonb) @> to_jsonb(v_phone));

  UPDATE public.leads SET phones = COALESCE(phones,'[]'::jsonb) || to_jsonb(v_dphone)
   WHERE id=p_lead_id AND v_dphone IS NOT NULL
     AND (jsonb_array_length(COALESCE(phones,'[]'::jsonb))=0 OR jsonb_typeof(phones->0)='string')
     AND NOT (COALESCE(phones,'[]'::jsonb) @> to_jsonb(v_dphone));

  UPDATE public.leads SET emails = COALESCE(emails,'[]'::jsonb) || to_jsonb(v_email)
   WHERE id=p_lead_id AND v_email IS NOT NULL
     AND (jsonb_array_length(COALESCE(emails,'[]'::jsonb))=0 OR jsonb_typeof(emails->0)='string')
     AND NOT (COALESCE(emails,'[]'::jsonb) @> to_jsonb(v_email));

  SELECT COALESCE(custom_field_values,'{}'::jsonb) INTO v_cfv FROM public.leads WHERE id=p_lead_id;
  IF v_meta_url IS NOT NULL AND COALESCE(v_cfv->>'52b04644-26c6-4df6-a981-d5378f872f62','')='' THEN
    v_cfv := v_cfv || jsonb_build_object('52b04644-26c6-4df6-a981-d5378f872f62', v_meta_url);
  END IF;
  IF v_gads_url IS NOT NULL AND COALESCE(v_cfv->>'8505f857-001c-44a9-b771-8cf3c2ecefeb','')='' THEN
    v_cfv := v_cfv || jsonb_build_object('8505f857-001c-44a9-b771-8cf3c2ecefeb', v_gads_url);
  END IF;
  UPDATE public.leads SET custom_field_values = v_cfv WHERE id=p_lead_id;

  -- Evento de histórico — só na primeira vez que o lead é enriquecido.
  IF v_org_id IS NOT NULL AND NOT COALESCE(v_was_enriched, false) THEN
    INSERT INTO public.interactions (org_id, lead_id, channel, type, message_content, performed_by, metadata)
    VALUES (
      v_org_id,
      p_lead_id,
      'system',
      'sent',
      'Dados atualizados via Receita Federal, Google Maps, Meta/Google Ads e Apollo.',
      NULL,
      jsonb_build_object('system_event', 'auto_enriched', 'provider', 'n8n')
    );
  END IF;
END; $function$;

COMMIT;

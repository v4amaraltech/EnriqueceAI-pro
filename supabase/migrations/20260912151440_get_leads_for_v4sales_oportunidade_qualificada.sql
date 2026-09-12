-- SAO (Oportunidade Aceita por Vendas) no sync do Sales Hub.
--
-- get_leads_for_v4sales passa a propagar `oportunidade_qualificada` = resposta do
-- closer à pergunta "Qualificada / Não qualificada" do feedback de reunião
-- realizada (closer_feedback_requests.oportunidade_qualificada, existe desde
-- 09/set/2026). Regra idêntica à do card "SAO" do Dashboard
-- (src/features/dashboard/utils/latest-sao-by-lead.ts): a resposta MAIS RECENTE
-- com a pergunta preenchida; sem resposta → NULL (não há proxy, diferente do
-- decisor_presente). O Sales Hub grava em leads_pv.oportunidade_qualificada
-- (upsert_leads_pv lê a chave do payload; o n8n "Sync Leads PV" não muda).
--
-- BASE deste corpo: a versão EM PRODUÇÃO, que é a migration
-- v4-sales-hub/supabase/migrations/20260815100000_enriquece_get_leads_for_v4sales_propaga_first_touch_at.sql
-- (conferida com pg_get_functiondef em 12/set/2026). A última versão no repo do
-- Enriquece (20260813130000) NÃO tem first_touch_at — não usar como base.
-- Decisão 12/set/2026: a partir daqui a RPC volta a ser mantida neste repo.
--
-- Assinatura e tipo de retorno não mudam (SETOF json) → CREATE OR REPLACE.
-- GRANT reafirmado no fim: recriar esta função já derrubou o EXECUTE de anon
-- (n8n chama como anon) e parou o sync por 3 dias em mai/2026.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_leads_for_v4sales(p_api_token text, p_from_date text DEFAULT NULL::text)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
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
        l.meeting_starts_at,
        EXISTS (SELECT 1 FROM closer_feedback_requests c WHERE c.lead_id = l.id) as tem_feedback_closer,
        (SELECT COALESCE(
                  c.decisor_presente,
                  CASE
                    WHEN c.qualificacao_aderente IN ('bateu', 'divergiu')
                      THEN NOT ('decisor' = ANY(COALESCE(c.divergencias, ARRAY[]::text[])))
                    ELSE NULL
                  END
                )
           FROM closer_feedback_requests c
          WHERE c.lead_id = l.id
            AND c.result = 'meeting_done'
            AND (
              c.decisor_presente IS NOT NULL
              OR c.qualificacao_aderente IN ('bateu', 'divergiu')
            )
          ORDER BY c.responded_at DESC NULLS LAST
          LIMIT 1) as decisor_presente,
        -- SAO: aceite comercial do closer (true/false); NULL = ainda sem resposta
        -- ou reunião anterior à pergunta. Sem fallback — não existe proxy p/ SAO.
        (SELECT c.oportunidade_qualificada
           FROM closer_feedback_requests c
          WHERE c.lead_id = l.id
            AND c.result = 'meeting_done'
            AND c.oportunidade_qualificada IS NOT NULL
          ORDER BY c.responded_at DESC NULLS LAST
          LIMIT 1) as oportunidade_qualificada,
        l.contacted_at,
        ft.first_touch_at,
        l.created_at as created_at_enriquece,
        l.updated_at as updated_at_enriquece,
        l.deleted_at
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT MIN(i.created_at) AS first_touch_at
        FROM interactions i
        WHERE i.lead_id = l.id
          AND i.type IN ('sent', 'delivered')
          AND i.channel IN ('phone','whatsapp','email','linkedin','research')
          AND coalesce(i.metadata->>'is_note', '') <> 'true'
      ) ft ON true
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
$function$;

-- Assinatura não mudou, então o ACL sobrevive ao REPLACE — reafirmado porque
-- recriação de função já derrubou GRANT nesta stack antes (n8n chama como anon).
GRANT EXECUTE ON FUNCTION public.get_leads_for_v4sales(text, text) TO anon, authenticated, service_role;

COMMIT;

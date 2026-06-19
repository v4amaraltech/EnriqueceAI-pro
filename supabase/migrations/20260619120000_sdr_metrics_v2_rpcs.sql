-- SDR metric RPCs v2 — definição canônica alinhada com os cards do dashboard
-- (feature dashboard, ranking-metrics.service.ts), pro Sales Hub (v4-sales-hub)
-- consumir 1:1 sem manter lógica duplicada.
--
-- Diferenças vs as funções sem sufixo (get_sdr_atividades_atrasadas /
-- get_sdr_leads_para_abrir), que eram hardcoded na org V4 Amaral e sem os
-- filtros do app:
--   * Parametrizadas por p_org_id (reutilizáveis por qualquer org).
--   * atividades_atrasadas_v2: cutoff now() - 4h (threshold OVERDUE_THRESHOLD_HOURS
--     do app, clampado a horário comercial BRT pela própria list_overdue_..._brt),
--     exclui leads won/unqualified/archived/deletados e conta só SDR ativo.
--   * leads_para_abrir_v2: "para abrir" = lead status='new' que NUNCA foi
--     adicionado a NENHUMA cadência (sem QUALQUER enrollment, mesmo
--     pausado/concluído) e de SDR ativo. Decisão do gestor (19/06/2026).
--
-- Ref: docs/sessions/ + v4-sales-hub/docs/briefings/2026-06-19-resposta-*.md

BEGIN;

-- 1) Atividades Atrasadas (espelha fetchOverdueActivitiesRanking)
CREATE OR REPLACE FUNCTION public.get_sdr_atividades_atrasadas_v2(p_org_id uuid)
RETURNS TABLE(email text, atrasadas bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  SELECT u.email::text, count(*)::bigint AS atrasadas
  FROM public.list_overdue_enrollments_brt(p_org_id, now() - interval '4 hours') o
  JOIN cadence_enrollments ce ON ce.id = o.id
  JOIN leads l ON l.id = ce.lead_id
  JOIN auth.users u ON u.id = l.assigned_to
  JOIN organization_members m
    ON m.user_id = l.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.deleted_at IS NULL
    AND l.status NOT IN ('won','unqualified','archived')
  GROUP BY u.email
  ORDER BY atrasadas DESC;
$function$;

-- 2) Leads para Abrir (espelha fetchLeadsToOpenRanking — sem cadência nenhuma)
CREATE OR REPLACE FUNCTION public.get_sdr_leads_para_abrir_v2(p_org_id uuid)
RETURNS TABLE(email text, na_fila bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  SELECT u.email::text, count(*)::bigint AS na_fila
  FROM leads l
  JOIN auth.users u ON u.id = l.assigned_to
  JOIN organization_members m
    ON m.user_id = l.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.status = 'new'
    AND NOT EXISTS (
      SELECT 1 FROM cadence_enrollments ce
      WHERE ce.lead_id = l.id
    )
  GROUP BY u.email
  ORDER BY na_fila DESC;
$function$;

-- Mesmos grants das funções v1 (PUBLIC + anon/authenticated/service_role)
GRANT EXECUTE ON FUNCTION public.get_sdr_atividades_atrasadas_v2(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sdr_leads_para_abrir_v2(uuid) TO anon, authenticated, service_role;

COMMIT;

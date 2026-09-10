-- "Leads para Abrir" passa a contar lead SEM CADÊNCIA AGORA (nem ativa, nem
-- pausada), e não mais só lead que NUNCA teve cadência.
--
-- Por quê (10/set/2026): o card do dashboard e o Sales Hub mostravam 307
-- leads para abrir, enquanto a tela de Leads com "Novo" + "Sem cadência"
-- mostrava ~1.100. A diferença eram ~770 leads que já passaram por uma
-- cadência (Prospecção Fria, Recovery, Recomendação…) e voltaram para "Novo"
-- — e que o SDR precisa abrir de novo. Decisão do gestor: o card segue a tela
-- de Leads. Substitui a definição de 19/06/2026 (20260619120000).
--
-- Fonte única: a view `leads_no_active_enrollment` (a mesma do filtro
-- "Sem cadência" de /leads e de fetchLeadsToOpenRanking no dashboard). Se a
-- regra de "em cadência" mudar, muda num lugar só.
--
-- Consumida pelo Sales Hub (anon, via supabaseEnriquece.rpc) — a mudança vale
-- lá na hora, sem deploy do Sales Hub.
--
-- CREATE OR REPLACE com a MESMA assinatura: preserva o ACL atual (anon,
-- authenticated, service_role). Nada de DROP — ver
-- security-definer-drop-recreate-regrants-authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sdr_leads_para_abrir_v2(p_org_id uuid)
RETURNS TABLE(email text, na_fila bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  SELECT u.email::text, count(*)::bigint AS na_fila
  FROM leads_no_active_enrollment l
  JOIN auth.users u ON u.id = l.assigned_to
  JOIN organization_members m
    ON m.user_id = l.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.org_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.status = 'new'
  GROUP BY u.email
  ORDER BY na_fila DESC;
$function$;

COMMIT;

-- Story conversion-analytics-rpc (set/2026).
--
-- Estatísticas › Conversão lia TODAS as interações do período (V4 Amaral:
-- ~58 mil em 90 dias, ~7 MB) só para saber, por lead, "teve sent / meeting /
-- replied no período?". Esta função devolve 1 linha por lead do universo com
-- esses marcadores + as inscrições em cadência que o cálculo usa. O resto da
-- regra (funil, velocidade, tabela por cadência, origem) continua em
-- `features/statistics/services/conversion-analytics.service.ts`.
--
-- Universo (igual ao service até o commit 64de0d57): leads da org, não
-- excluídos, com created_by ∈ p_user_ids (se houver), que foram criados no
-- período, OU tiveram interação no período (só da cadência p_cadence_id, se
-- houver), OU têm won_at / lost_at / meeting_held_at no período.
--
-- Inscrições: só das cadências não excluídas da org (ou só p_cadence_id), de
-- qualquer época (vínculo lead↔cadência). `for_velocity` = enrolled_at no
-- período E enrolled_by ∈ p_user_ids (se houver).
--
-- SECURITY INVOKER: roda com a RLS de quem chama (a tela é só de gestor, e
-- `leads_org_read` libera todos os leads da org para gestor). Org vem de
-- public.user_org_id() — sem parâmetro de org. Medido como gestor da V4
-- Amaral (10/set/2026): 30 dias 93 ms, 90 dias 149 ms, 365 dias 704 ms.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_conversion_universe(
  p_start timestamptz,
  p_end timestamptz,
  p_user_ids uuid[] DEFAULT NULL,
  p_cadence_id uuid DEFAULT NULL
)
RETURNS TABLE (
  lead_id uuid,
  status public.lead_status,
  created_by uuid,
  won_at timestamptz,
  has_sent boolean,
  has_meeting_scheduled boolean,
  has_replied boolean,
  enrollments jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH org AS (
    SELECT public.user_org_id() AS id
  ),
  flags AS (
    SELECT i.lead_id,
           bool_or(i.type = 'sent') AS has_sent,
           bool_or(i.type = 'meeting_scheduled') AS has_meeting_scheduled,
           bool_or(i.type = 'replied') AS has_replied
    FROM public.interactions i
    WHERE i.org_id = (SELECT id FROM org)
      AND i.created_at BETWEEN p_start AND p_end
      AND (p_cadence_id IS NULL OR i.cadence_id = p_cadence_id)
    GROUP BY i.lead_id
  ),
  universe AS (
    SELECT l.id, l.status, l.created_by, l.won_at
    FROM public.leads l
    LEFT JOIN flags f ON f.lead_id = l.id
    WHERE l.org_id = (SELECT id FROM org)
      AND l.deleted_at IS NULL
      AND (coalesce(cardinality(p_user_ids), 0) = 0 OR l.created_by = ANY (p_user_ids))
      AND (l.created_at BETWEEN p_start AND p_end
        OR l.won_at BETWEEN p_start AND p_end
        OR l.lost_at BETWEEN p_start AND p_end
        OR l.meeting_held_at BETWEEN p_start AND p_end
        OR f.lead_id IS NOT NULL)
  ),
  cad_set AS (
    SELECT c.id
    FROM public.cadences c
    WHERE p_cadence_id IS NULL
      AND c.org_id = (SELECT id FROM org)
      AND c.deleted_at IS NULL
    UNION ALL
    SELECT p_cadence_id WHERE p_cadence_id IS NOT NULL
  ),
  enr AS (
    SELECT ce.lead_id,
           jsonb_agg(jsonb_build_object(
             'cadence_id', ce.cadence_id,
             'enrolled_at', ce.enrolled_at,
             'updated_at', ce.updated_at,
             'for_velocity', ce.enrolled_at BETWEEN p_start AND p_end
               AND (coalesce(cardinality(p_user_ids), 0) = 0 OR ce.enrolled_by = ANY (p_user_ids))
           ) ORDER BY ce.enrolled_at, ce.id) AS enrollments
    FROM public.cadence_enrollments ce
    JOIN cad_set cs ON cs.id = ce.cadence_id
    JOIN universe u ON u.id = ce.lead_id
    WHERE ce.org_id = (SELECT id FROM org)
    GROUP BY ce.lead_id
  )
  SELECT u.id,
         u.status,
         u.created_by,
         u.won_at,
         coalesce(f.has_sent, false),
         coalesce(f.has_meeting_scheduled, false),
         coalesce(f.has_replied, false),
         coalesce(e.enrollments, '[]'::jsonb)
  FROM universe u
  LEFT JOIN flags f ON f.lead_id = u.id
  LEFT JOIN enr e ON e.lead_id = u.id
$$;

COMMENT ON FUNCTION public.get_conversion_universe(timestamptz, timestamptz, uuid[], uuid) IS
  'Estatísticas › Conversão: 1 linha por lead do universo do período com marcadores de interação e inscrições. SECURITY INVOKER (RLS de quem chama). Story conversion-analytics-rpc.';

-- O Supabase concede EXECUTE a anon/authenticated em toda função nova de
-- public; aqui só gestor logado (authenticated) e o servidor usam.
REVOKE ALL ON FUNCTION public.get_conversion_universe(timestamptz, timestamptz, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversion_universe(timestamptz, timestamptz, uuid[], uuid) TO authenticated, service_role;

COMMIT;

-- Story statistics-rpc-integration-tests (set/2026).
--
-- Correção achada pelo teste de integração: em get_conversion_universe, com
-- filtro de SDR (p_user_ids), uma inscrição SEM enrolled_by voltava com
-- `for_velocity = null` (NULL = ANY(...) → NULL) em vez de `false`. Sem efeito
-- na tela (o TS só usa as inscrições com for_velocity verdadeiro), mas o
-- contrato é boolean. Resto da função idêntico à 20260911030704.
--
-- CREATE OR REPLACE mantém as permissões atuais (sem DROP); o REVOKE/GRANT é
-- repetido só por segurança.

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
             -- coalesce: inscrição sem enrolled_by + filtro de SDR dava NULL
             -- (NULL = ANY(...)) em vez de false.
             'for_velocity', coalesce(
               ce.enrolled_at BETWEEN p_start AND p_end
                 AND (coalesce(cardinality(p_user_ids), 0) = 0 OR ce.enrolled_by = ANY (p_user_ids)),
               false
             )
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

REVOKE ALL ON FUNCTION public.get_conversion_universe(timestamptz, timestamptz, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversion_universe(timestamptz, timestamptz, uuid[], uuid) TO authenticated, service_role;

COMMIT;

BEGIN;

-- RPC pra dashboard de Atividades Atrasadas usar o clamp business-hours.
-- Retorna IDs de enrollments active da org cujo next_step_due (clampado
-- pra próxima abertura de expediente) é anterior ao cutoff.
CREATE OR REPLACE FUNCTION public.list_overdue_enrollments_brt(
  p_org_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog AS $$
  SELECT ce.id
  FROM cadence_enrollments ce
  WHERE ce.org_id = p_org_id
    AND ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND public.effective_due_brt(ce.next_step_due) < p_cutoff;
$$;

COMMIT;

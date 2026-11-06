-- Story executed-step-scoped-to-enrollment (06/out/2026)
-- Eventos `system` deixam de contar como "passo já feito". O
-- `advance_enrollment_after_step` grava `step_skipped` com step_id e type='sent';
-- isso (a) escondia o passo pulado da fila/atrasadas e (b) ocupava a vaga do
-- índice único uq_interactions_sent_step_lead, impedindo registrar a execução
-- real do passo depois (23505). Agora:
--   * as 4 funções de "passo feito" ignoram i.channel = 'system';
--   * o índice único passa a valer só para execuções reais (channel <> 'system').
-- Mesma regra no app: execute-activity.ts (idempotência) e execute-cadence.ts.
-- FORA: lead reinscrito na mesma cadência (o índice não conhece a inscrição) —
-- story separada. Assinaturas inalteradas (CREATE OR REPLACE mantém grants) →
-- sem regenerar types.ts.
BEGIN;

-- 0. Índice único só para execuções reais. Todo par que era único antes continua
--    único (o novo predicado é um subconjunto), então a criação não falha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interactions_sent_step_lead_real
  ON public.interactions (cadence_id, step_id, lead_id)
  WHERE type = 'sent' AND step_id IS NOT NULL AND channel <> 'system';
DROP INDEX IF EXISTS public.uq_interactions_sent_step_lead;

-- 1. Fila (fetch-pending-activities)
CREATE OR REPLACE FUNCTION public.get_executed_steps(p_cadence_ids uuid[], p_step_ids uuid[], p_lead_ids uuid[])
 RETURNS TABLE(cadence_id uuid, step_id uuid, lead_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.cadence_id, i.step_id, i.lead_id
  FROM interactions i
  WHERE i.org_id = public.user_org_id()
    AND i.cadence_id = ANY(p_cadence_ids)
    AND i.step_id = ANY(p_step_ids)
    AND i.lead_id = ANY(p_lead_ids)
    AND i.step_id IS NOT NULL
    AND i.type <> 'failed'
    AND i.channel <> 'system';
END;
$function$;

-- 2. Atrasadas por inscrição
CREATE OR REPLACE FUNCTION public.list_overdue_enrollments_brt(p_org_id uuid, p_cutoff timestamp with time zone)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT ce.id
  FROM cadence_enrollments ce
  JOIN cadences c ON c.id = ce.cadence_id
  JOIN leads l ON l.id = ce.lead_id
  LEFT JOIN cadence_steps cs
    ON cs.cadence_id = ce.cadence_id AND cs.step_order = ce.current_step
  WHERE ce.org_id = p_org_id
    AND ce.status = 'active'
    AND ce.next_step_due IS NOT NULL
    AND public.effective_due_brt(ce.next_step_due) < p_cutoff
    AND c.type <> 'auto_email'
    AND COALESCE(
      (cs.channel = 'whatsapp' OR (cs.channel = 'phone' AND cs.call_provider = 'whatsapp'))
      AND l.whatsapp_invalid_at IS NOT NULL, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = ce.cadence_id
        AND i.step_id = cs.id
        AND i.step_id IS NOT NULL
        AND i.lead_id = ce.lead_id
        AND i.type <> 'failed'
        AND i.channel <> 'system'
    );
$function$;

-- 3. Atrasadas por tarefa (card do dashboard)
CREATE OR REPLACE FUNCTION public.list_overdue_activities_brt(p_org_id uuid, p_cutoff timestamp with time zone)
 RETURNS TABLE(enrollment_id uuid, lead_id uuid, step_id uuid, assigned_to uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH base AS (
    SELECT ce.id AS enr_id, ce.cadence_id, ce.lead_id, ce.current_step,
           ce.next_step_due, l.assigned_to, l.whatsapp_invalid_at
    FROM cadence_enrollments ce
    JOIN cadences c ON c.id = ce.cadence_id
    JOIN leads l ON l.id = ce.lead_id
    WHERE ce.org_id = p_org_id
      AND ce.status = 'active'
      AND ce.next_step_due IS NOT NULL
      AND ce.next_step_due <= now()
      AND c.type <> 'auto_email'
      AND l.deleted_at IS NULL
  ),
  expanded AS (
    SELECT b.enr_id, b.cadence_id, b.lead_id, b.next_step_due, b.assigned_to,
           b.whatsapp_invalid_at, s.id AS step_id, s.channel, s.call_provider,
           SUM(CASE WHEN s.step_order > b.current_step
                    THEN s.delay_days * 24 + s.delay_hours ELSE 0 END)
             OVER (PARTITION BY b.enr_id ORDER BY s.step_order) AS cum_hours
    FROM base b
    JOIN cadence_steps s
      ON s.cadence_id = b.cadence_id AND s.step_order >= b.current_step
  )
  SELECT e.enr_id, e.lead_id, e.step_id, e.assigned_to
  FROM expanded e
  WHERE e.cum_hours <= 24
    AND public.effective_due_brt(
          e.next_step_due + make_interval(hours => e.cum_hours::int)
        ) < p_cutoff
    AND COALESCE(
          (e.channel = 'whatsapp' OR (e.channel = 'phone' AND e.call_provider = 'whatsapp'))
          AND e.whatsapp_invalid_at IS NOT NULL, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = e.cadence_id
        AND i.step_id = e.step_id
        AND i.step_id IS NOT NULL
        AND i.lead_id = e.lead_id
        AND i.type <> 'failed'
        AND i.channel <> 'system'
    );
$function$;

-- 4. Resumo diário do SDR (régua do dia útil seguinte, 20261005200000)
CREATE OR REPLACE FUNCTION public.fetch_overdue_manual_activities()
 RETURNS TABLE(lead_id uuid, assigned_to uuid, org_id uuid, channel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    AND public.effective_due_brt(ce.next_step_due)
        < (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
    AND c.type <> 'auto_email'
    AND cs.channel::text <> 'email'
    AND COALESCE(
      (cs.channel = 'whatsapp' OR (cs.channel = 'phone' AND cs.call_provider = 'whatsapp'))
      AND l.whatsapp_invalid_at IS NOT NULL, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.cadence_id = ce.cadence_id
        AND i.step_id = cs.id
        AND i.step_id IS NOT NULL
        AND i.lead_id = ce.lead_id
        AND i.type <> 'failed'
        AND i.channel <> 'system'
    )
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND l.status NOT IN ('won', 'unqualified', 'archived');
$function$;

COMMIT;

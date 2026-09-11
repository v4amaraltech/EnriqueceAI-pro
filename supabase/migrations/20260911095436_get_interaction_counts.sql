-- Story activity-performance-analytics-rpc (set/2026).
--
-- Estatísticas › Atividades e › Performance baixavam TODAS as interações do
-- período (V4 Amaral: ~35 mil em 90 dias) só para contar. Esta função devolve
-- as contagens já agrupadas (~1,4 mil linhas em 90 dias):
--
--   row_kind = 'cell'      → 1 linha por (autor, canal, tipo, dia de Brasília)
--                            com n, first_at e last_at;
--   row_kind = 'performer' → 1 linha por autor com distinct_leads
--                            (count DISTINCT lead_id), first_at e last_at.
--
-- performed_by nulo = interação sem autor (automação) — continua nas somas.
-- Dia de Brasília = created_at − 3h (igual ao TS; sem horário de verão).
-- first_at existe para o TS reproduzir a ordem de desempate das telas (que era
-- a ordem da primeira atividade de cada canal/tipo/SDR).
--
-- Filtros iguais aos services até o commit 54274a2: período fechado nos dois
-- lados; canal fora de p_exclude_channels (Atividades: system,calendar;
-- Performance: system); performed_by ∈ p_user_ids se houver; cadence_id =
-- p_cadence_id se houver.
--
-- SECURITY INVOKER (RLS de quem chama; as telas são só de gestor). Org via
-- (SELECT public.user_org_id()) — avaliada uma vez, não linha a linha.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_interaction_counts(
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_channels public.channel_type[],
  p_user_ids uuid[] DEFAULT NULL,
  p_cadence_id uuid DEFAULT NULL
)
RETURNS TABLE (
  row_kind text,
  performed_by uuid,
  channel public.channel_type,
  type public.interaction_type,
  day_brt date,
  n bigint,
  distinct_leads bigint,
  first_at timestamptz,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT i.performed_by, i.channel, i.type, i.lead_id, i.created_at
    FROM public.interactions i
    WHERE i.org_id = (SELECT public.user_org_id())
      AND i.created_at BETWEEN p_start AND p_end
      AND i.channel <> ALL (coalesce(p_exclude_channels, '{}'))
      AND (coalesce(cardinality(p_user_ids), 0) = 0 OR i.performed_by = ANY (p_user_ids))
      AND (p_cadence_id IS NULL OR i.cadence_id = p_cadence_id)
  )
  SELECT 'cell'::text,
         b.performed_by,
         b.channel,
         b.type,
         ((b.created_at AT TIME ZONE 'UTC') - interval '3 hours')::date,
         count(*),
         NULL::bigint,
         min(b.created_at),
         max(b.created_at)
  FROM base b
  GROUP BY b.performed_by, b.channel, b.type, ((b.created_at AT TIME ZONE 'UTC') - interval '3 hours')::date
  UNION ALL
  SELECT 'performer'::text,
         b.performed_by,
         NULL,
         NULL,
         NULL,
         NULL,
         count(DISTINCT b.lead_id),
         min(b.created_at),
         max(b.created_at)
  FROM base b
  GROUP BY b.performed_by
$$;

COMMENT ON FUNCTION public.get_interaction_counts(timestamptz, timestamptz, public.channel_type[], uuid[], uuid) IS
  'Estatísticas › Atividades e › Performance: contagens de interações por autor/canal/tipo/dia de Brasília + leads distintos por autor. SECURITY INVOKER. Story activity-performance-analytics-rpc.';

-- O Supabase concede EXECUTE a anon/authenticated em toda função nova de
-- public; aqui só gestor logado (authenticated) e o servidor usam.
REVOKE ALL ON FUNCTION public.get_interaction_counts(timestamptz, timestamptz, public.channel_type[], uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_interaction_counts(timestamptz, timestamptz, public.channel_type[], uuid[], uuid) TO authenticated, service_role;

COMMIT;

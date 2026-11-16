BEGIN;

-- Cockpit: candidatos do cartão "Próxima ligação" ordenados no banco (spec cockpit-lead-frio).
--
-- Devolve, para a carteira inteira de um SDR/closer:
--   1) TODOS os "possíveis quentes" (maybe_hot = true): pré-filtro largo de interesse real
--      (DP-7: envio/abertura de e-mail NÃO esquenta). O TS confirma o score v2 depois;
--      nenhum peso de score existe aqui.
--   2) Os `p_cold_limit` primeiros por `cold_rank` (ordem do lead frio).
--
-- Ordem do frio (cold_rank), nesta sequência:
--   a) over_attempts asc  : mais de `p_max_attempts` ligações em `p_attempts_window_days` desce (DP-2)
--   b) cadência           : vencida (next_step_due <= p_now) < futura < sem cadência (DP-3)
--   c) next_step_due asc  : dentro da cadência, o mais vencido primeiro
--   d) attempts_recent asc: menos ligações nos últimos `p_recent_days` dias (DP-1)
--   e) last_call_at asc   : ligação mais antiga primeiro (todo o histórico); nunca ligado vem antes
--   f) updated_at desc, id asc : desempate estável
-- Teto diário (DP-1): só o frio sai do cold_rank quando calls_today >= p_daily_cap (0 = sem teto).
-- O dia é o dia de Brasília (America/Sao_Paulo), contando ligações de qualquer origem.
--
-- Segurança: SECURITY INVOKER, search_path vazio, org_id filtrado em TODA tabela
-- (quem chama é service_role, que ignora RLS). Só service_role executa. Somente leitura.

CREATE OR REPLACE FUNCTION public.cockpit_next_call_candidates(
  p_org_id                uuid,
  p_target_user_id        uuid,
  p_interest_dispositions text[],
  p_bant_field_names      text[],
  p_exclude_lead_ids      uuid[]       DEFAULT '{}',
  p_now                   timestamptz  DEFAULT now(),
  p_signal_window_days    int          DEFAULT 90,
  p_recent_days           int          DEFAULT 7,
  p_attempts_window_days  int          DEFAULT 30,
  p_max_attempts          int          DEFAULT 6,
  p_daily_cap             int          DEFAULT 2,
  p_cold_limit            int          DEFAULT 20
)
RETURNS TABLE (
  lead_id          uuid,
  updated_at       timestamptz,
  maybe_hot        boolean,
  next_step_due    timestamptz,
  attempts_recent  int,
  attempts_window  int,
  calls_today      int,
  last_call_at     timestamptz,
  over_attempts    boolean,
  cold_rank        int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH params AS (
    SELECT
      p_now - make_interval(days => p_signal_window_days)                      AS signal_since,
      p_now - make_interval(days => p_recent_days)                             AS recent_since,
      p_now - make_interval(days => p_attempts_window_days)                    AS window_since,
      p_now - make_interval(days => greatest(p_attempts_window_days, p_recent_days)) AS calls_since,
      (date_trunc('day', p_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS today_start
  ),
  -- Pré-filtro de interesse calculado UMA vez por organização (e não por lead): usa idx_interactions_type
  -- (org_id, type, created_at); comparar o enum como texto impediria o índice.
  hot_inter AS (
    SELECT DISTINCT i.lead_id
    FROM public.interactions i, params p
    WHERE i.org_id = p_org_id
      AND i.type IN ('replied', 'meeting_scheduled')
      AND i.created_at >= p.signal_since
  ),
  bant AS (
    SELECT COALESCE(array_agg(cf.id::text), '{}'::text[]) AS ids
    FROM public.custom_fields cf
    WHERE cf.org_id = p_org_id AND cf.field_name = ANY (p_bant_field_names)
  ),
  cart AS (
    SELECT l.id, l.updated_at, l.custom_field_values
    FROM public.leads l
    WHERE l.org_id = p_org_id
      AND l.deleted_at IS NULL
      AND l.status NOT IN ('unqualified', 'archived')
      AND l.telefone IS NOT NULL AND btrim(l.telefone) <> ''
      AND (l.assigned_to = p_target_user_id OR l.closer_id = p_target_user_id)
      AND NOT (l.id = ANY (COALESCE(p_exclude_lead_ids, '{}'::uuid[])))
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_holds h
        WHERE h.lead_id = l.id AND h.org_id = p_org_id AND h.tipo = 'total'
      )
  ),
  enriched AS (
    SELECT
      c.id,
      c.updated_at,
      enr.next_step_due,
      COALESCE(cl.attempts_recent, 0) AS attempts_recent,
      COALESCE(cl.attempts_window, 0) AS attempts_window,
      COALESCE(cl.calls_today, 0)     AS calls_today,
      lc.last_call_at,
      (
        c.id IN (SELECT hi.lead_id FROM hot_inter hi)
        OR EXISTS (
          SELECT 1 FROM public.calls k, params p
          WHERE k.lead_id = c.id AND k.org_id = p_org_id
            AND k.created_at >= p.signal_since
            AND (
              k.sdr_disposition::text = ANY (p_interest_dispositions)
              OR (k.metadata -> 'ai_outcome' ->> 'disposition') = ANY (p_interest_dispositions)
            )
        )
        OR EXISTS (
          SELECT 1 FROM unnest((SELECT b.ids FROM bant b)) AS bf(id)
          WHERE btrim(c.custom_field_values ->> bf.id) <> ''
        )
        OR EXISTS (
          SELECT 1 FROM public.decision_events d
          WHERE d.lead_id = c.id AND d.org_id = p_org_id AND d.event_type = 'human_correction'
        )
      ) AS maybe_hot
    FROM cart c
    LEFT JOIN LATERAL (
      SELECT min(e.next_step_due) AS next_step_due
      FROM public.cadence_enrollments e
      WHERE e.lead_id = c.id AND e.org_id = p_org_id AND e.status::text = 'active'
    ) enr ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE k.created_at >= (SELECT recent_since FROM params))::int  AS attempts_recent,
        count(*) FILTER (WHERE k.created_at >= (SELECT window_since FROM params))::int  AS attempts_window,
        count(*) FILTER (WHERE k.created_at >= (SELECT today_start FROM params))::int   AS calls_today
      FROM public.calls k
      WHERE k.lead_id = c.id AND k.org_id = p_org_id
        AND k.created_at >= (SELECT calls_since FROM params)
    ) cl ON true
    -- Última ligação de TODO o histórico (sem janela): quem foi ligado há 200 dias não empata com "nunca ligado".
    LEFT JOIN LATERAL (
      SELECT max(COALESCE(k.started_at, k.created_at)) AS last_call_at
      FROM public.calls k
      WHERE k.lead_id = c.id AND k.org_id = p_org_id
    ) lc ON true
  ),
  ranked AS (
    SELECT
      e.*,
      (e.attempts_window > p_max_attempts) AS over_attempts,
      CASE
        WHEN e.calls_today >= p_daily_cap AND p_daily_cap > 0 THEN NULL
        ELSE row_number() OVER (
          ORDER BY
            (e.attempts_window > p_max_attempts) ASC,
            CASE
              WHEN e.next_step_due IS NULL THEN 2
              WHEN e.next_step_due <= p_now THEN 0
              ELSE 1
            END ASC,
            e.next_step_due ASC NULLS LAST,
            e.attempts_recent ASC,
            e.last_call_at ASC NULLS FIRST,
            e.updated_at DESC,
            e.id ASC
        )
      END AS cold_rank_raw
    FROM enriched e
  ),
  -- row_number acima numera também as linhas com teto estourado (descartadas); renumera só as elegíveis.
  eligible AS (
    SELECT r.id, row_number() OVER (ORDER BY r.cold_rank_raw ASC) AS cold_rank
    FROM ranked r
    WHERE r.cold_rank_raw IS NOT NULL
  )
  SELECT
    r.id                AS lead_id,
    r.updated_at,
    r.maybe_hot,
    r.next_step_due,
    r.attempts_recent,
    r.attempts_window,
    r.calls_today,
    r.last_call_at,
    r.over_attempts,
    el.cold_rank::int   AS cold_rank
  FROM ranked r
  LEFT JOIN eligible el ON el.id = r.id
  WHERE r.maybe_hot OR el.cold_rank <= p_cold_limit
  ORDER BY el.cold_rank ASC NULLS LAST, r.id ASC;
$$;

-- Supabase concede EXECUTE a anon/authenticated em função nova: revogar de forma explícita.
REVOKE ALL ON FUNCTION public.cockpit_next_call_candidates(uuid, uuid, text[], text[], uuid[], timestamptz, int, int, int, int, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_next_call_candidates(uuid, uuid, text[], text[], uuid[], timestamptz, int, int, int, int, int, int)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

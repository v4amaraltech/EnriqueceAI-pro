BEGIN;

-- Cockpit, fila de recuperação: o desfecho novo `referred_contact` ("Indicou outro contato") conta como
-- CONVERSA REAL, igual a `callback_requested` (espelha utils/real-conversation.ts). Sem isto a ligação curta
-- cairia na regra de duração e o lead perdido voltaria a ser ligado.
-- Mesmo corpo de 20261116132051_cockpit_recovery_candidates.sql; só mudam as 3 listas de desfechos.
-- CREATE OR REPLACE (nunca DROP). Compara como texto, não usa o enum direto.

CREATE OR REPLACE FUNCTION public.cockpit_recovery_candidates(
  p_org_id                  uuid,
  p_target_user_id          uuid,
  p_exclude_lead_ids        uuid[]       DEFAULT '{}',
  p_now                     timestamptz  DEFAULT now(),
  p_blocked_reason_names    text[]       DEFAULT ARRAY[
    'Blocklist', 'Adolescente/Criança', 'Ex-cliente (detrator)', 'Duplicado',
    'Engano/Não Lembra', 'Pessoa Física', 'Desqualificado pelo closer'
  ],
  p_blocked_hold_types      text[]       DEFAULT ARRAY['total', 'prospeccao'],
  p_attempts_window_days    int          DEFAULT 30,
  p_max_attempts_per_day    int          DEFAULT 3,
  p_limit                   int          DEFAULT 1000
)
RETURNS TABLE (
  lead_id             uuid,
  lost_at             timestamptz,
  loss_reason_name    text,
  updated_at          timestamptz,
  calls_today         int,
  attempts_window     int,
  last_call_at        timestamptz,
  conversation_today  boolean,
  callback_pending    boolean,
  recovery_rank       int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH params AS (
    SELECT
      p_now - make_interval(days => p_attempts_window_days) AS window_since,
      (date_trunc('day', p_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS today_start
  ),
  cart AS (
    SELECT l.id, l.lost_at, l.updated_at, lr.name AS loss_reason_name
    FROM public.leads l
    LEFT JOIN public.loss_reasons lr ON lr.id = l.loss_reason_id AND lr.org_id = p_org_id
    WHERE l.org_id = p_org_id
      AND l.status = 'unqualified'
      AND l.lost_at IS NOT NULL
      AND l.deleted_at IS NULL
      AND l.telefone IS NOT NULL AND btrim(l.telefone) <> ''
      AND (l.assigned_to = p_target_user_id OR l.closer_id = p_target_user_id)
      AND NOT (l.id = ANY (COALESCE(p_exclude_lead_ids, '{}'::uuid[])))
      -- Lead SEM motivo (lr.name NULL) fica na fila: `NOT (NULL = ANY(...))` daria NULL e o excluiria sem querer.
      AND (lr.name IS NULL OR lr.name <> ALL (COALESCE(p_blocked_reason_names, '{}'::text[])))
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_holds h
        WHERE h.lead_id = l.id AND h.org_id = p_org_id
          AND h.tipo = ANY (COALESCE(p_blocked_hold_types, '{}'::text[]))
      )
  ),
  enriched AS (
    SELECT
      c.id, c.lost_at, c.updated_at, c.loss_reason_name,
      COALESCE(k.calls_today, 0)          AS calls_today,
      COALESCE(k.attempts_window, 0)      AS attempts_window,
      k.last_call_at,
      COALESCE(k.conversation_today, false) AS conversation_today,
      COALESCE(k.conversed_since_loss, false) AS conversed_since_loss,
      EXISTS (
        SELECT 1 FROM public.scheduled_activities sa
        WHERE sa.lead_id = c.id AND sa.org_id = p_org_id
          AND sa.status = 'pending' AND sa.channel::text = 'phone' AND sa.kind = 'return'
          AND sa.scheduled_at <= p_now
      ) AS callback_pending
    FROM cart c
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE x.created_at >= (SELECT today_start FROM params))::int  AS calls_today,
        count(*) FILTER (WHERE x.created_at >= (SELECT window_since FROM params))::int AS attempts_window,
        max(x.at)                                                                      AS last_call_at,
        bool_or(x.conv) FILTER (WHERE x.created_at >= (SELECT today_start FROM params)) AS conversation_today,
        bool_or(x.conv) FILTER (WHERE x.created_at >= c.lost_at)                       AS conversed_since_loss
      FROM (
        SELECT
          k0.created_at,
          COALESCE(k0.started_at, k0.created_at) AS at,
          CASE
            WHEN k0.sdr_disposition::text IN ('relevant_conversation', 'answered_no_progress', 'callback_requested', 'referred_contact') THEN true
            WHEN k0.sdr_disposition::text IN ('voicemail', 'no_answer', 'technical_failure') THEN false
            WHEN (k0.metadata -> 'ai_outcome' ->> 'status') = 'done'
                 -- 'no_answer' entra na lista só para valer como NÃO conversa (igual a real-conversation.ts); sem ele cairia na duração.
                 AND (k0.metadata -> 'ai_outcome' ->> 'disposition') IN
                     ('relevant_conversation', 'answered_no_progress', 'callback_requested', 'referred_contact', 'voicemail', 'no_answer', 'technical_failure')
                 AND COALESCE((k0.metadata -> 'ai_outcome' ->> 'applied'), 'true') <> 'false'
                 AND COALESCE((k0.metadata -> 'ai_outcome' ->> 'needs_review'), 'false') <> 'true'
                 AND CASE WHEN jsonb_typeof(k0.metadata -> 'ai_outcome' -> 'confidence') = 'number'
                          THEN (k0.metadata -> 'ai_outcome' ->> 'confidence')::numeric >= 0.7
                          ELSE false END
              THEN (k0.metadata -> 'ai_outcome' ->> 'disposition') IN ('relevant_conversation', 'answered_no_progress', 'callback_requested', 'referred_contact')
            ELSE k0.answered_at IS NOT NULL AND COALESCE(k0.duration_seconds, 0) >= 50
          END AS conv
        FROM public.calls k0
        WHERE k0.lead_id = c.id AND k0.org_id = p_org_id
      ) x
    ) k ON true
  )
  SELECT
    e.id                AS lead_id,
    e.lost_at,
    e.loss_reason_name,
    e.updated_at,
    e.calls_today,
    e.attempts_window,
    e.last_call_at,
    e.conversation_today,
    e.callback_pending,
    (row_number() OVER (ORDER BY e.lost_at DESC NULLS LAST, e.id ASC))::int AS recovery_rank
  FROM enriched e
  WHERE (NOT e.conversed_since_loss OR e.callback_pending)
    AND (p_max_attempts_per_day <= 0 OR e.calls_today < p_max_attempts_per_day)
  ORDER BY e.lost_at DESC NULLS LAST, e.id ASC
  LIMIT p_limit;
$$;

-- Supabase concede EXECUTE a anon/authenticated em função nova: revogar de forma explícita.
REVOKE ALL ON FUNCTION public.cockpit_recovery_candidates(uuid, uuid, uuid[], timestamptz, text[], text[], int, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_recovery_candidates(uuid, uuid, uuid[], timestamptz, text[], text[], int, int, int)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

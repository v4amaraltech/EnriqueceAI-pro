-- Auto-perda também para quem TERMINA a cadência (fim do limbo)
--
-- Problema: o RPC só olhava enrollments 'active'. O prazo de inatividade da
-- cadência (auto_loss_after_days) é um cronômetro que parava junto com a
-- cadência: quando o motor concluía o enrollment (sem próximo passo), o lead
-- ficava 'contacted' sem cadência e nunca mais era avaliado — não virava
-- 'unqualified', não recebia motivo e não entrava na Recovery. Ficava em
-- limbo para sempre.
--
-- Solução: a função vira um UNION ALL de duas partes.
--   Parte A — inalterada: enrollments 'active' (comportamento de hoje).
--   Parte B — nova: enrollments 'completed', com três travas.
--
-- O parâmetro p_include_completed (DEFAULT false) é o que torna o deploy
-- seguro: chamada sem argumentos — que é o que o código ANTIGO faz — devolve
-- exatamente o que a função devolvia antes. Assim esta migration pode ser
-- aplicada em prod antes do deploy do código sem ativar nada. A parte B só
-- liga quando o código novo passa p_include_completed => true.
--
-- Ref: docs/stories/cadence-end-auto-loss.story.md

BEGIN;

-- A assinatura muda (novo parâmetro + nova coluna de retorno), então
-- CREATE OR REPLACE não basta.
DROP FUNCTION IF EXISTS public.fetch_inactive_enrollment_candidates();

CREATE OR REPLACE FUNCTION public.fetch_inactive_enrollment_candidates(
  p_include_completed boolean DEFAULT false
)
RETURNS TABLE(
  enrollment_id uuid,
  lead_id uuid,
  org_id uuid,
  cadence_id uuid,
  auto_loss_reason_id uuid,
  auto_loss_after_days integer,
  inactive_days integer,
  enrollment_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH last_activity AS (
    SELECT lead_id, max(created_at) AS last_at
    FROM interactions
    GROUP BY lead_id
  ),

  -- Parte A: enrollments ativos. Query idêntica à versão anterior — um lead
  -- ativo em duas cadências continua rendendo duas linhas (o job expira as
  -- duas e deduplica o lead do lado da aplicação).
  active_part AS (
    SELECT
      ce.id AS enrollment_id,
      ce.lead_id,
      c.org_id,
      c.id AS cadence_id,
      c.auto_loss_reason_id,
      c.auto_loss_after_days,
      extract(day FROM (now() - GREATEST(ce.enrolled_at, COALESCE(la.last_at, ce.enrolled_at))))::int AS inactive_days,
      'active'::text AS enrollment_status
    FROM cadence_enrollments ce
    JOIN cadences c ON c.id = ce.cadence_id
    LEFT JOIN last_activity la ON la.lead_id = ce.lead_id
    JOIN leads l ON l.id = ce.lead_id
    WHERE ce.status = 'active'
      AND c.status = 'active'
      AND c.deleted_at IS NULL
      AND c.auto_loss_after_days IS NOT NULL
      AND c.auto_loss_reason_id IS NOT NULL
      AND l.deleted_at IS NULL
      AND l.status NOT IN ('won', 'unqualified', 'archived')
      AND now() - GREATEST(ce.enrolled_at, COALESCE(la.last_at, ce.enrolled_at)) > make_interval(days => c.auto_loss_after_days)
  ),

  -- Parte B: um candidato por lead — sempre o enrollment concluído mais
  -- recente, para o motivo de perda ser o da ÚLTIMA cadência por que o lead
  -- passou. O DISTINCT ON roda ANTES do filtro de prazo de propósito: filtrar
  -- primeiro faria um enrollment antigo já vencido "ganhar" de um recente
  -- ainda dentro do prazo, carimbando o motivo da cadência errada.
  completed_latest AS (
    SELECT DISTINCT ON (ce.lead_id)
      ce.id AS enrollment_id,
      ce.lead_id,
      c.org_id,
      c.id AS cadence_id,
      c.auto_loss_reason_id,
      c.auto_loss_after_days,
      ce.enrolled_at,
      la.last_at
    FROM cadence_enrollments ce
    JOIN cadences c ON c.id = ce.cadence_id
    LEFT JOIN last_activity la ON la.lead_id = ce.lead_id
    JOIN leads l ON l.id = ce.lead_id
    WHERE p_include_completed
      AND ce.status = 'completed'
      AND c.status = 'active'
      AND c.deleted_at IS NULL
      AND c.auto_loss_after_days IS NOT NULL
      AND c.auto_loss_reason_id IS NOT NULL
      AND l.deleted_at IS NULL
      -- Trava 1: só lead 'contacted'. 'new' e 'qualified' (reunião marcada)
      -- ficam de fora mesmo com cadência concluída.
      AND l.status = 'contacted'
      -- Trava 2: nenhuma outra cadência em andamento — senão uma cadência
      -- antiga concluída marcaria perdido um lead sendo trabalhado em outra.
      AND NOT EXISTS (
        SELECT 1 FROM cadence_enrollments a
        WHERE a.lead_id = ce.lead_id
          AND a.status IN ('active', 'paused')
      )
    ORDER BY ce.lead_id, ce.completed_at DESC NULLS LAST, ce.enrolled_at DESC
  ),

  completed_part AS (
    SELECT
      b.enrollment_id,
      b.lead_id,
      b.org_id,
      b.cadence_id,
      b.auto_loss_reason_id,
      b.auto_loss_after_days,
      extract(day FROM (now() - GREATEST(b.enrolled_at, COALESCE(b.last_at, b.enrolled_at))))::int AS inactive_days,
      'completed'::text AS enrollment_status
    FROM completed_latest b
    WHERE now() - GREATEST(b.enrolled_at, COALESCE(b.last_at, b.enrolled_at)) > make_interval(days => b.auto_loss_after_days)
  )

  SELECT * FROM active_part
  UNION ALL
  SELECT * FROM completed_part;
$function$;

-- Mesmo perfil de permissão da função anterior: SÓ service_role (o cron roda
-- com service role).
--
-- ⚠️ `authenticated` PRECISA estar no REVOKE. Recriar a função faz o default
-- privilege do schema public reconceder EXECUTE a `authenticated` — foi o que
-- aconteceu ao aplicar esta migration em prod, e exigiu a correção
-- 20260909184517. A função é SECURITY DEFINER e lê enrollments/leads de TODAS
-- as orgs sem filtro de tenant: com EXECUTE, qualquer usuário logado
-- enumeraria a base inteira. O REVOKE de 20260516160057 não sobrevive ao
-- DROP/CREATE.
REVOKE EXECUTE ON FUNCTION public.fetch_inactive_enrollment_candidates(boolean) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_inactive_enrollment_candidates(boolean) TO service_role;

COMMIT;

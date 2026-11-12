BEGIN;

-- Atualização automática do CRM, regra v1.1 (medição shadow de 11/11 na V4 Amaral).
-- Aditiva: só amplia o CHECK de skip_reason com 'opt_out_requested' e acrescenta a
-- coluna skipped_opt_out_requested no FIM da view diária.
-- Não toca em dados: sem UPDATE, sem DELETE. O log segue append-only.
-- Não altera calls, leads, scheduled_activities, interactions nem call_qualifications.
-- A view crm_auto_update_shadow_comparison não muda.
-- NÃO aplicar antes do PR aprovado. Até lá o worker v1.1 que gravar opt_out_requested
-- falha no CHECK e só loga 'log_failed' (nada é escrito no CRM).

-- 1. skip_reason aceita opt_out_requested -------------------------------------------
-- O CHECK original foi declarado inline na coluna (nome gerado pelo Postgres). Remove
-- qualquer CHECK que restrinja skip_reason a uma lista, menos o de verdict/reason.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.crm_auto_update_shadow_log'::regclass
      AND contype = 'c'
      AND conname <> 'crm_auto_update_shadow_log_verdict_reason'
      AND pg_get_constraintdef(oid) ILIKE '%skip_reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.crm_auto_update_shadow_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.crm_auto_update_shadow_log
  ADD CONSTRAINT crm_auto_update_shadow_log_skip_reason_check CHECK (skip_reason IN (
    'org_not_allowed',
    'qualification_not_completed',
    'needs_review',
    'low_confidence',
    'unmapped_outcome',
    'already_dispositioned',
    'no_lead',
    'opt_out_requested'
  ));

COMMENT ON COLUMN public.crm_auto_update_shadow_log.proposed_changes IS
  'O que mudaria: {disposition, next_activity: {type, channel}, lead_status: {from, to} | null}. Calculado mesmo quando verdict = skip, para comparar com o SDR. Desde v1.1, com pedido de opt-out na ligação: opt_out {requested, channels, patterns, suggested_actions, applied: false}. É só proposta: nada é aplicado.';

-- 2. View diária com a contagem de opt-out ----------------------------------------
CREATE OR REPLACE VIEW public.crm_auto_update_shadow_agreement_daily
WITH (security_invoker = true) AS
SELECT
  org_id,
  (decided_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  count(*) AS logged,
  count(*) FILTER (WHERE verdict = 'would_apply') AS would_apply,
  count(*) FILTER (WHERE verdict = 'skip') AS skipped,
  count(*) FILTER (WHERE skip_reason = 'needs_review') AS skipped_needs_review,
  count(*) FILTER (WHERE skip_reason = 'low_confidence') AS skipped_low_confidence,
  count(*) FILTER (WHERE skip_reason = 'already_dispositioned') AS skipped_already_dispositioned,
  count(*) FILTER (WHERE skip_reason = 'unmapped_outcome') AS skipped_unmapped_outcome,
  count(*) FILTER (WHERE skip_reason = 'no_lead') AS skipped_no_lead,
  count(*) FILTER (WHERE disposition_comparison = 'pending_sdr') AS pending_sdr,
  count(*) FILTER (WHERE disposition_comparison IN ('agree', 'disagree')) AS compared,
  count(*) FILTER (WHERE disposition_comparison = 'agree') AS agreed,
  count(*) FILTER (WHERE disposition_comparison = 'disagree') AS diverged,
  round(
    (count(*) FILTER (WHERE disposition_comparison = 'agree'))::numeric
      / NULLIF(count(*) FILTER (WHERE disposition_comparison IN ('agree', 'disagree')), 0),
    4
  ) AS agreement_rate,
  round(
    (count(*) FILTER (WHERE verdict = 'would_apply' AND disposition_comparison = 'agree'))::numeric
      / NULLIF(count(*) FILTER (WHERE verdict = 'would_apply' AND disposition_comparison IN ('agree', 'disagree')), 0),
    4
  ) AS would_apply_agreement_rate,
  round(
    (count(*) FILTER (WHERE group_comparison = 'agree'))::numeric
      / NULLIF(count(*) FILTER (WHERE group_comparison IN ('agree', 'disagree')), 0),
    4
  ) AS group_agreement_rate,
  round(
    (count(*) FILTER (WHERE next_activity_comparison = 'agree'))::numeric
      / NULLIF(count(*) FILTER (WHERE next_activity_comparison IN ('agree', 'disagree')), 0),
    4
  ) AS next_activity_agreement_rate,
  -- v1.1: coluna nova sempre no fim (CREATE OR REPLACE VIEW só aceita acrescentar no final).
  count(*) FILTER (WHERE skip_reason = 'opt_out_requested') AS skipped_opt_out_requested
FROM public.crm_auto_update_shadow_comparison
GROUP BY org_id, (decided_at AT TIME ZONE 'America/Sao_Paulo')::date;

COMMENT ON VIEW public.crm_auto_update_shadow_agreement_daily IS
  'Concordância diária entre o shadow da atualização automática do CRM e o SDR, por org. skipped_opt_out_requested conta pedidos de opt-out detectados (regra v1.1).';

REVOKE ALL ON public.crm_auto_update_shadow_agreement_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_auto_update_shadow_agreement_daily TO service_role;

COMMIT;

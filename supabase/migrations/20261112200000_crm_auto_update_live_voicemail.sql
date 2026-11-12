BEGIN;

-- Atualização automática do CRM, escrita LIVE do desfecho caixa postal (regra v1.1).
--
-- NÃO aplicar em produção neste PR. Aplicar junto com o deploy, depois do PR aprovado.
-- Ordem: esta migration PRIMEIRO, depois o código. Se o código subir antes, o INSERT
-- no log com as colunas novas (applied, applied_at) falha e o worker registra log_failed.
-- Pior caso nessa ordem invertida: o UPDATE em calls já passou e o log não; o marcador
-- calls.metadata.crm_auto_update deixa a próxima execução gravar só o log, sem escrever
-- de novo no CRM.
--
-- Aditiva:
--   1. crm_auto_update_shadow_log ganha applied e applied_at (linhas antigas: false e nulo).
--   2. A view de comparação marca a nossa escrita como auto_applied, fora de agree/disagree,
--      para ela não contar como concordância do SDR.
--   3. A view diária ganha applied_live no FIM.
--   4. Só o note da flag crm_auto_update_v1_live muda. enabled e allow_org_ids NÃO mudam.
-- Sem UPDATE nem DELETE de dados do log (segue append-only). Não altera calls, leads,
-- scheduled_activities, interactions, call_transcripts_v2 nem call_qualifications.

-- 1. Colunas da escrita live ------------------------------------------------------------
ALTER TABLE public.crm_auto_update_shadow_log
  ADD COLUMN IF NOT EXISTS applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

ALTER TABLE public.crm_auto_update_shadow_log
  DROP CONSTRAINT IF EXISTS crm_auto_update_shadow_log_applied_check;
ALTER TABLE public.crm_auto_update_shadow_log
  ADD CONSTRAINT crm_auto_update_shadow_log_applied_check CHECK (
    (applied = false AND applied_at IS NULL)
    OR (applied = true AND applied_at IS NOT NULL AND mode = 'live' AND verdict = 'would_apply')
  );

COMMENT ON COLUMN public.crm_auto_update_shadow_log.applied IS
  'true quando o modo live escreveu o desfecho no CRM (calls.sdr_disposition = voicemail e marcador em calls.metadata.crm_auto_update). Nasce no INSERT: o log é append-only. false para shadow e para live que só registrou.';
COMMENT ON COLUMN public.crm_auto_update_shadow_log.applied_at IS
  'Momento da escrita no CRM (o mesmo de calls.metadata.crm_auto_update.applied_at). Nulo quando applied = false.';

-- 2. Comparação: a nossa escrita não é concordância do SDR ------------------------------
-- auto_applied entra ANTES de pending_sdr/agree/disagree nas três comparações. Colunas
-- novas (auto_applied, auto_applied_at) só no fim: CREATE OR REPLACE VIEW não reordena.
CREATE OR REPLACE VIEW public.crm_auto_update_shadow_comparison
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    l.id AS log_id,
    l.call_id,
    l.org_id,
    l.lead_id,
    l.qualification_id,
    l.mode,
    l.verdict,
    l.skip_reason,
    l.rules_version,
    l.created_at AS decided_at,
    l.proposed_changes->>'disposition' AS proposed_disposition,
    l.proposed_changes->'next_activity'->>'type' AS proposed_next_activity,
    l.proposed_changes->'lead_status'->>'to' AS proposed_lead_status,
    l.input_snapshot->>'outcome' AS ai_outcome,
    (l.input_snapshot->>'confidence')::numeric AS ai_confidence,
    l.input_snapshot->>'sdr_disposition' AS sdr_disposition_at_decision,
    c.sdr_disposition::text AS sdr_disposition,
    c.started_at AS call_started_at,
    (
      c.metadata->'ai_outcome'->>'status' = 'done'
      AND coalesce(c.metadata->'ai_outcome'->>'applied', 'true') <> 'false'
      AND c.metadata->'ai_outcome'->>'disposition' IS NOT NULL
    ) AS legacy_ai_applied,
    ld.status::text AS lead_status_now,
    EXISTS (
      SELECT 1
      FROM public.scheduled_activities sa
      WHERE l.lead_id IS NOT NULL
        AND sa.lead_id = l.lead_id
        AND sa.org_id = l.org_id
        AND sa.channel = 'phone'
        AND sa.created_at >= c.started_at
        AND sa.created_at < c.started_at + interval '24 hours'
    ) AS sdr_scheduled_callback,
    l.applied IS TRUE AS auto_applied,
    l.applied_at AS auto_applied_at
  FROM public.crm_auto_update_shadow_log l
  JOIN public.calls c ON c.id = l.call_id
  LEFT JOIN public.leads ld ON ld.id = l.lead_id
),
grouped AS (
  SELECT
    b.*,
    CASE
      WHEN b.proposed_disposition IN ('relevant_conversation', 'callback_requested') THEN 'conversation'
      WHEN b.proposed_disposition = 'answered_no_progress' THEN 'no_progress'
      WHEN b.proposed_disposition IS NOT NULL THEN 'no_human'
    END AS proposed_group,
    CASE
      WHEN b.sdr_disposition IN ('relevant_conversation', 'callback_requested') THEN 'conversation'
      WHEN b.sdr_disposition = 'answered_no_progress' THEN 'no_progress'
      WHEN b.sdr_disposition IS NOT NULL THEN 'no_human'
    END AS sdr_group
  FROM base b
)
SELECT
  g.log_id,
  g.call_id,
  g.org_id,
  g.lead_id,
  g.qualification_id,
  g.mode,
  g.verdict,
  g.skip_reason,
  g.rules_version,
  g.decided_at,
  g.proposed_disposition,
  g.proposed_next_activity,
  g.proposed_lead_status,
  g.ai_outcome,
  g.ai_confidence,
  g.sdr_disposition_at_decision,
  g.sdr_disposition,
  g.call_started_at,
  g.legacy_ai_applied,
  g.lead_status_now,
  g.sdr_scheduled_callback,
  g.proposed_group,
  g.sdr_group,
  CASE
    WHEN g.proposed_disposition IS NULL THEN 'no_proposal'
    WHEN g.auto_applied THEN 'auto_applied'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN g.sdr_disposition = g.proposed_disposition THEN 'agree'
    ELSE 'disagree'
  END AS disposition_comparison,
  CASE
    WHEN g.proposed_disposition IS NULL THEN 'no_proposal'
    WHEN g.auto_applied THEN 'auto_applied'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN g.sdr_group = g.proposed_group THEN 'agree'
    ELSE 'disagree'
  END AS group_comparison,
  CASE
    WHEN g.proposed_next_activity IS NULL THEN 'no_proposal'
    WHEN g.auto_applied THEN 'auto_applied'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN (g.proposed_next_activity = 'callback') = g.sdr_scheduled_callback THEN 'agree'
    ELSE 'disagree'
  END AS next_activity_comparison,
  g.auto_applied,
  g.auto_applied_at
FROM grouped g;

COMMENT ON VIEW public.crm_auto_update_shadow_comparison IS
  'Proposta da atualização automática x desfecho registrado pelo SDR, por ligação. auto_applied = desfecho escrito pelo modo live (fora de agree/disagree, não é concordância do SDR). Divergências: WHERE disposition_comparison = ''disagree''.';

-- 3. View diária com a contagem da escrita live ------------------------------------------
-- auto_applied já fica fora de compared/agreed/diverged e das taxas (não é agree nem disagree).
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
  count(*) FILTER (WHERE skip_reason = 'opt_out_requested') AS skipped_opt_out_requested,
  -- Coluna nova sempre no fim (CREATE OR REPLACE VIEW só aceita acrescentar no final).
  count(*) FILTER (WHERE auto_applied) AS applied_live
FROM public.crm_auto_update_shadow_comparison
GROUP BY org_id, (decided_at AT TIME ZONE 'America/Sao_Paulo')::date;

COMMENT ON VIEW public.crm_auto_update_shadow_agreement_daily IS
  'Concordância diária entre a atualização automática do CRM e o SDR, por org. skipped_opt_out_requested conta pedidos de opt-out detectados (v1.1). applied_live conta desfechos escritos pelo modo live, que ficam fora das taxas de concordância.';

REVOKE ALL ON public.crm_auto_update_shadow_comparison FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_auto_update_shadow_agreement_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_auto_update_shadow_comparison TO service_role;
GRANT SELECT ON public.crm_auto_update_shadow_agreement_daily TO service_role;

-- 4. Só o texto da flag live. enabled e allow_org_ids continuam como estão ---------------
UPDATE public.app_flags
SET note = 'Modo LIVE da atualização automática do CRM. Só vale para orgs listadas aqui E em crm_auto_update_v1. enabled = true global é ignorado. Nesta versão escreve SOMENTE o desfecho de caixa postal (outcome JEV voicemail) com confiança >= 0,85 em calls.sdr_disposition, sem criar atividade e sem mudar o status do lead. O resto continua só no log.'
WHERE key = 'crm_auto_update_v1_live';

COMMIT;

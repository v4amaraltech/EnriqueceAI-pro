BEGIN;

-- Atualização automática do CRM a partir da qualificação JEV (call_qualifications).
-- Aditiva: cria 2 flags DESLIGADAS, 1 tabela append-only e 2 views.
-- Não altera calls, scheduled_activities, leads, interactions nem dados existentes.
--
-- Modos (ver src/features/calls/services/crm-auto-update/constants.ts):
--   off    = org fora de allow_org_ids de crm_auto_update_v1 (padrão para todas).
--   shadow = org em allow_org_ids de crm_auto_update_v1: grava só a proposta no log.
--   live   = exige shadow E a org em allow_org_ids de crm_auto_update_v1_live.
--            enabled = true global na flag live é ignorado pelo código.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'crm_auto_update_v1',
  false,
  'Atualização automática do CRM pela qualificação JEV, modo SHADOW: grava só a proposta em crm_auto_update_shadow_log, sem escrever em calls/leads/atividades. Para ligar uma org, acrescente o uuid em allow_org_ids. Não ligue a flag globalmente.',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'crm_auto_update_v1_live',
  false,
  'Modo LIVE da atualização automática do CRM. Só vale para orgs listadas aqui E em crm_auto_update_v1. enabled = true global é ignorado. Nesta versão o live ainda não escreve no CRM.',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crm_auto_update_shadow_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  qualification_id uuid NOT NULL REFERENCES public.call_qualifications(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('shadow', 'live')),
  verdict text NOT NULL CHECK (verdict IN ('would_apply', 'skip')),
  skip_reason text CHECK (skip_reason IN (
    'org_not_allowed',
    'qualification_not_completed',
    'needs_review',
    'low_confidence',
    'unmapped_outcome',
    'already_dispositioned',
    'no_lead'
  )),
  proposed_changes jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_version text NOT NULL,
  qualification_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_auto_update_shadow_log_call_unique UNIQUE (call_id),
  CONSTRAINT crm_auto_update_shadow_log_verdict_reason CHECK (
    (verdict = 'would_apply' AND skip_reason IS NULL AND proposed_changes IS NOT NULL)
    OR (verdict = 'skip' AND skip_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.crm_auto_update_shadow_log IS
  'Proposta de atualização do CRM calculada a partir da qualificação JEV. Uma linha por ligação (idempotente). Append-only: sem UPDATE nem DELETE. Em shadow nada é aplicado.';
COMMENT ON COLUMN public.crm_auto_update_shadow_log.proposed_changes IS
  'O que mudaria: {disposition, next_activity: {type, channel}, lead_status: {from, to} | null}. Calculado mesmo quando verdict = skip, para comparar com o SDR.';
COMMENT ON COLUMN public.crm_auto_update_shadow_log.input_snapshot IS
  'Entradas da decisão no momento: outcome, next_step_suggestion, confidence, needs_review(_reasons), sdr_disposition, status do lead.';

-- Sem UPDATE: o service faz select + insert e a UNIQUE (call_id) segura a corrida.
CREATE INDEX IF NOT EXISTS idx_crm_auto_update_shadow_log_org_created
  ON public.crm_auto_update_shadow_log (org_id, created_at);

CREATE OR REPLACE FUNCTION public.reject_crm_auto_update_shadow_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crm_auto_update_shadow_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS crm_auto_update_shadow_log_append_only ON public.crm_auto_update_shadow_log;
CREATE TRIGGER crm_auto_update_shadow_log_append_only
  BEFORE UPDATE OR DELETE ON public.crm_auto_update_shadow_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_crm_auto_update_shadow_log_mutation();

ALTER TABLE public.crm_auto_update_shadow_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_auto_update_shadow_log FORCE ROW LEVEL SECURITY;

-- Leitura: só manager da própria org (dado de avaliação interna).
DROP POLICY IF EXISTS crm_auto_update_shadow_log_manager_read ON public.crm_auto_update_shadow_log;
CREATE POLICY crm_auto_update_shadow_log_manager_read ON public.crm_auto_update_shadow_log
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

-- service_role ignora RLS por padrão; a policy deixa explícito o acesso do worker.
DROP POLICY IF EXISTS crm_auto_update_shadow_log_service ON public.crm_auto_update_shadow_log;
CREATE POLICY crm_auto_update_shadow_log_service ON public.crm_auto_update_shadow_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.crm_auto_update_shadow_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_auto_update_shadow_log TO authenticated;
GRANT SELECT, INSERT ON public.crm_auto_update_shadow_log TO service_role;

-- Comparação linha a linha: proposta x o que o SDR registrou (lido AO VIVO em calls).
-- disposition_comparison:
--   no_proposal = desfecho sem mapeamento seguro
--   pending_sdr = SDR ainda não registrou desfecho
--   legacy_ai   = desfecho gravado pelo fluxo antigo do Power Dialer (fora da conta)
--   agree / disagree
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
    ) AS sdr_scheduled_callback
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
  g.*,
  CASE
    WHEN g.proposed_disposition IS NULL THEN 'no_proposal'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN g.sdr_disposition = g.proposed_disposition THEN 'agree'
    ELSE 'disagree'
  END AS disposition_comparison,
  CASE
    WHEN g.proposed_disposition IS NULL THEN 'no_proposal'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN g.sdr_group = g.proposed_group THEN 'agree'
    ELSE 'disagree'
  END AS group_comparison,
  CASE
    WHEN g.proposed_next_activity IS NULL THEN 'no_proposal'
    WHEN g.sdr_disposition IS NULL THEN 'pending_sdr'
    WHEN g.legacy_ai_applied THEN 'legacy_ai'
    WHEN (g.proposed_next_activity = 'callback') = g.sdr_scheduled_callback THEN 'agree'
    ELSE 'disagree'
  END AS next_activity_comparison
FROM grouped g;

COMMENT ON VIEW public.crm_auto_update_shadow_comparison IS
  'Proposta do shadow x desfecho registrado pelo SDR, por ligação. Divergências: WHERE disposition_comparison = ''disagree''.';

-- Agregado diário por org: volume, motivos de skip e taxa de concordância.
-- agreement_rate considera todas as propostas comparáveis; would_apply_agreement_rate
-- só as que seriam aplicadas sem humano (o número que decide ligar o live).
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
  ) AS next_activity_agreement_rate
FROM public.crm_auto_update_shadow_comparison
GROUP BY org_id, (decided_at AT TIME ZONE 'America/Sao_Paulo')::date;

COMMENT ON VIEW public.crm_auto_update_shadow_agreement_daily IS
  'Concordância diária entre o shadow da atualização automática do CRM e o SDR, por org.';

REVOKE ALL ON public.crm_auto_update_shadow_comparison FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_auto_update_shadow_agreement_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_auto_update_shadow_comparison TO service_role;
GRANT SELECT ON public.crm_auto_update_shadow_agreement_daily TO service_role;

COMMIT;

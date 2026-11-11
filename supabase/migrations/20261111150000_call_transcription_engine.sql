BEGIN;

-- Motor paralelo de transcrição (AssemblyAI) + qualificação (JEV/TypeSafe).
-- Aditivo: não altera calls, calls.transcription, BANT nem o fluxo whisper-1.
-- A flag nasce desligada para todos. Não aplica sozinha em produção.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'call_transcription_engine_v1',
  false,
  'Motor paralelo AssemblyAI + JEV em call_transcripts_v2 e call_qualifications. Desligada: nada roda. Para ligar uma org, acrescente o uuid em allow_org_ids. Não ligue a flag globalmente (ligaria todas as orgs).',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.call_transcripts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  text text,
  utterances jsonb,
  speakers_count int,
  audio_seconds numeric,
  cost_usd numeric,
  latency_ms int,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_transcripts_v2_call_provider_unique UNIQUE (call_id, provider)
);

COMMENT ON TABLE public.call_transcripts_v2 IS 'Transcrição do motor paralelo. Uma linha por (call_id, provider). Texto e falas são imutáveis depois de completed. Sem DELETE.';
COMMENT ON COLUMN public.call_transcripts_v2.error IS 'Motivo da falha ou skip (ex.: duration_mismatch, duration_too_short, no_recording).';

CREATE INDEX IF NOT EXISTS idx_call_transcripts_v2_org_created
  ON public.call_transcripts_v2 (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_v2_status
  ON public.call_transcripts_v2 (status);

CREATE TABLE IF NOT EXISTS public.call_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transcript_id uuid REFERENCES public.call_transcripts_v2(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  outcome text,
  interest text,
  objections jsonb,
  next_step_suggestion text,
  summary text,
  answers jsonb,
  confidence numeric,
  needs_review boolean NOT NULL DEFAULT false,
  cost_usd numeric,
  latency_ms int,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_qualifications_call_provider_unique UNIQUE (call_id, provider)
);

COMMENT ON TABLE public.call_qualifications IS 'Qualificação estruturada (JEV/TypeSafe) do motor paralelo. Campos semânticos imutáveis depois de completed. Sem DELETE.';

CREATE INDEX IF NOT EXISTS idx_call_qualifications_org_created
  ON public.call_qualifications (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_qualifications_status
  ON public.call_qualifications (status);

-- Trava: sem DELETE; depois de completed, o conteúdo não muda. Antes disso
-- (pending/processing/failed) só o service_role atualiza status e resultado.
CREATE OR REPLACE FUNCTION public.reject_call_transcript_v2_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'call_transcripts_v2 is append-only';
  END IF;
  IF NEW.call_id IS DISTINCT FROM OLD.call_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'call_transcripts_v2 identity is immutable';
  END IF;
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.text IS DISTINCT FROM OLD.text
       OR NEW.utterances IS DISTINCT FROM OLD.utterances
       OR NEW.speakers_count IS DISTINCT FROM OLD.speakers_count
       OR NEW.audio_seconds IS DISTINCT FROM OLD.audio_seconds
       OR NEW.cost_usd IS DISTINCT FROM OLD.cost_usd
       OR NEW.model IS DISTINCT FROM OLD.model
     ) THEN
    RAISE EXCEPTION 'call_transcripts_v2 completed row is append-only';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_transcripts_v2_append_only ON public.call_transcripts_v2;
CREATE TRIGGER call_transcripts_v2_append_only
  BEFORE UPDATE OR DELETE ON public.call_transcripts_v2
  FOR EACH ROW EXECUTE FUNCTION public.reject_call_transcript_v2_mutation();

CREATE OR REPLACE FUNCTION public.reject_call_qualification_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'call_qualifications is append-only';
  END IF;
  IF NEW.call_id IS DISTINCT FROM OLD.call_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'call_qualifications identity is immutable';
  END IF;
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.interest IS DISTINCT FROM OLD.interest
       OR NEW.objections IS DISTINCT FROM OLD.objections
       OR NEW.next_step_suggestion IS DISTINCT FROM OLD.next_step_suggestion
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.confidence IS DISTINCT FROM OLD.confidence
       OR NEW.needs_review IS DISTINCT FROM OLD.needs_review
       OR NEW.transcript_id IS DISTINCT FROM OLD.transcript_id
     ) THEN
    RAISE EXCEPTION 'call_qualifications completed row is append-only';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_qualifications_append_only ON public.call_qualifications;
CREATE TRIGGER call_qualifications_append_only
  BEFORE UPDATE OR DELETE ON public.call_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.reject_call_qualification_mutation();

ALTER TABLE public.call_transcripts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_transcripts_v2 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.call_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_qualifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_transcripts_v2_org_read ON public.call_transcripts_v2;
CREATE POLICY call_transcripts_v2_org_read ON public.call_transcripts_v2
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.user_org_id()));

DROP POLICY IF EXISTS call_qualifications_org_read ON public.call_qualifications;
CREATE POLICY call_qualifications_org_read ON public.call_qualifications
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.user_org_id()));

-- service_role ignora RLS por padrão; as políticas abaixo deixam explícito o acesso do worker.
DROP POLICY IF EXISTS call_transcripts_v2_service ON public.call_transcripts_v2;
CREATE POLICY call_transcripts_v2_service ON public.call_transcripts_v2
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS call_qualifications_service ON public.call_qualifications;
CREATE POLICY call_qualifications_service ON public.call_qualifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.call_transcripts_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.call_qualifications FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, call_id, org_id, provider, model, text, utterances, speakers_count,
  audio_seconds, latency_ms, status, error, created_at, updated_at
) ON public.call_transcripts_v2 TO authenticated;

GRANT SELECT (
  id, call_id, org_id, transcript_id, provider, model, outcome, interest, objections,
  next_step_suggestion, summary, confidence, needs_review, latency_ms, status, error,
  created_at, updated_at
) ON public.call_qualifications TO authenticated;

-- UPDATE só para status/resultado de retry; DELETE nunca (trigger também bloqueia).
GRANT SELECT, INSERT, UPDATE ON public.call_transcripts_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.call_qualifications TO service_role;

-- Monitoramento agregado por org e dia. Sem texto bruto. security_invoker = true:
-- respeita o RLS de quem consulta (manager vê só a própria org; service_role vê tudo).
CREATE OR REPLACE VIEW public.call_transcription_engine_daily
WITH (security_invoker = true) AS
SELECT
  t.org_id,
  (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  count(*) AS attempted,
  count(*) FILTER (WHERE t.status = 'completed') AS completed,
  count(*) FILTER (WHERE t.status = 'failed') AS failed,
  count(*) FILTER (WHERE t.status = 'skipped') AS skipped,
  round(
    (count(*) FILTER (WHERE t.status = 'failed'))::numeric / NULLIF(count(*), 0),
    4
  ) AS failure_rate,
  count(*) FILTER (
    WHERE t.status = 'completed'
      AND coalesce(length(btrim(t.text)), 0) = 0
      AND coalesce(t.audio_seconds, 0) >= 30
  ) AS empty_transcripts,
  count(*) FILTER (WHERE t.error LIKE 'duration_mismatch%') AS duration_mismatches,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY t.latency_ms)
    FILTER (WHERE t.latency_ms IS NOT NULL) AS latency_ms_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms)
    FILTER (WHERE t.latency_ms IS NOT NULL) AS latency_ms_p95,
  coalesce(sum(t.cost_usd), 0) AS transcript_cost_usd,
  coalesce(sum(q.cost_usd), 0) AS qualification_cost_usd,
  count(*) FILTER (WHERE q.needs_review) AS needs_review
FROM public.call_transcripts_v2 t
LEFT JOIN public.call_qualifications q ON q.call_id = t.call_id AND q.provider = 'jev'
GROUP BY t.org_id, (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date;

COMMENT ON VIEW public.call_transcription_engine_daily IS 'Métricas diárias do motor paralelo de transcrição. Sem texto bruto.';

REVOKE ALL ON public.call_transcription_engine_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.call_transcription_engine_daily TO service_role;

COMMIT;

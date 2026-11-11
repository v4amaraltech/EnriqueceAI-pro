BEGIN;

-- Aditivo: coluna nullable com os códigos que ligaram needs_review.
-- Não reescreve linhas completed. A trava de imutabilidade passa a incluir a coluna nova.

ALTER TABLE public.call_qualifications
  ADD COLUMN IF NOT EXISTS needs_review_reasons text[];

COMMENT ON COLUMN public.call_qualifications.needs_review_reasons IS
  'Códigos estáveis dos motivos que ligaram needs_review (ex.: outcome_low_confidence, duration_warning, incoherent_outcome_next_step). Nulo nas linhas antigas; vazio quando não há revisão. Imutável depois de completed.';

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
       OR NEW.needs_review_reasons IS DISTINCT FROM OLD.needs_review_reasons
       OR NEW.transcript_id IS DISTINCT FROM OLD.transcript_id
     ) THEN
    RAISE EXCEPTION 'call_qualifications completed row is append-only';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

GRANT SELECT (needs_review_reasons) ON public.call_qualifications TO authenticated;

COMMIT;

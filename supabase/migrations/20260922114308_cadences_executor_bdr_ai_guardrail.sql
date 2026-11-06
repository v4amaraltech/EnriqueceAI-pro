-- Cadências executadas pela IA (BDR IA) não têm SDR humano: quem executa os
-- passos é o n8n, via claim_due_steps (BDR-2). A trava enforce_enrollment_has_owner
-- (06/08/2026) exige leads.assigned_to em cadência manual (type <> 'auto_email')
-- e por isso bloqueava a inscrição na "BDR IA — Arroz (contato)": em 22/09 os
-- 25 leads do piloto estavam sem responsável e a cadência tinha 0 inscritos.
--
-- Solução: marcador explícito `cadences.executor` ('sdr' | 'bdr_ai'). A trava
-- passa a liberar cadência auto_email OU executor = 'bdr_ai'. Cadências de SDR
-- continuam exigindo responsável (o guard-rail original segue valendo).
--
-- CREATE OR REPLACE (não DROP+CREATE) para preservar as ACLs da função
-- SECURITY DEFINER. Forward-only.

BEGIN;

-- 1. Marcador de executor na cadência
ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS executor TEXT NOT NULL DEFAULT 'sdr';

ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS chk_cadences_executor;
ALTER TABLE public.cadences
  ADD CONSTRAINT chk_cadences_executor CHECK (executor IN ('sdr', 'bdr_ai'));

COMMENT ON COLUMN public.cadences.executor IS
  'Quem executa os passos: sdr (fila de atividades; inscrição exige leads.assigned_to) '
  'ou bdr_ai (n8n via claim_due_steps; inscrição sem responsável permitida).';

-- 2. Trava: libera auto_email OU executor = bdr_ai
CREATE OR REPLACE FUNCTION public.enforce_enrollment_has_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cadence_type text;
  v_executor     text;
  v_assigned_to  uuid;
BEGIN
  SELECT type::text, executor
    INTO v_cadence_type, v_executor
    FROM public.cadences
   WHERE id = NEW.cadence_id;

  -- Cadência auto_email dispara sozinha → não exige responsável.
  IF v_cadence_type = 'auto_email' THEN
    RETURN NEW;
  END IF;

  -- Cadência executada pela IA (BDR) → o executor é o n8n, não um SDR.
  IF v_executor = 'bdr_ai' THEN
    RETURN NEW;
  END IF;

  SELECT assigned_to INTO v_assigned_to FROM public.leads WHERE id = NEW.lead_id;

  IF v_assigned_to IS NULL THEN
    RAISE EXCEPTION
      'Lead sem responsável não pode ser inscrito em cadência manual (tipo: %).',
      COALESCE(v_cadence_type, 'desconhecido')
      USING ERRCODE = 'check_violation',
            HINT = 'Atribua um SDR ao lead (assigned_to) antes de inscrever, ou use uma cadência auto_email / executor bdr_ai.';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Marca as cadências do piloto BDR IA (V4 Amaral). Idempotente.
UPDATE public.cadences
   SET executor = 'bdr_ai'
 WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
   AND name LIKE 'BDR IA — %'
   AND deleted_at IS NULL
   AND executor <> 'bdr_ai';

COMMIT;

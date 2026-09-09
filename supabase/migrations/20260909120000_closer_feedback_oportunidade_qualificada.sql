-- Captura estruturada de "Oportunidade Qualificada (SAO)" no feedback do closer.
--
-- CONTEXTO: SAO (Sales Accepted Opportunity) é o aceite comercial da oportunidade
-- pelo closer — ele diz se a oportunidade entregue pelo pré-vendas é de fato uma
-- oportunidade de venda. NÃO se confunde com `qualificacao_aderente` ("a
-- qualificação bateu?"), que mede se a INFORMAÇÃO registrada pelo pré-vendas
-- conferiu na reunião. Uma reunião pode ter qualificação que "bateu" e ainda
-- assim não virar oportunidade qualificada (e vice-versa).
--
-- Só é preenchido quando result='meeting_done' (a reunião aconteceu). Para
-- no_show/rescheduled o valor fica NULL. NULL também = não respondido /
-- histórico anterior a esta coluna (sem backfill — não há fonte confiável).
--
-- Idempotente, forward-only.

ALTER TABLE public.closer_feedback_requests
  ADD COLUMN IF NOT EXISTS oportunidade_qualificada boolean;

COMMENT ON COLUMN public.closer_feedback_requests.oportunidade_qualificada IS
  'Oportunidade Qualificada (SAO): closer aceita ou não a oportunidade (só quando result=meeting_done). true = Qualificada, false = Não qualificada, NULL = não respondido / não se aplica. Distinto de qualificacao_aderente (aderência da informação do pré-vendas).';

-- Espelha o padrão dos constraints de divergências: o campo só existe em
-- reuniões realizadas. Adicionado via DO block para manter idempotência.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'closer_feedback_sao_somente_se_realizada'
      AND conrelid = 'public.closer_feedback_requests'::regclass
  ) THEN
    ALTER TABLE public.closer_feedback_requests
      ADD CONSTRAINT closer_feedback_sao_somente_se_realizada
      CHECK (oportunidade_qualificada IS NULL OR result = 'meeting_done');
  END IF;
END $$;

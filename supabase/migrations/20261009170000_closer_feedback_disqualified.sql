-- Feedback do closer: novo resultado "Desqualificada".
-- A reunião ACONTECEU (carimba meeting_held_at), mas o closer viu que o lead
-- não tem fit: o lead vira Perdido (motivo "Desqualificado pelo closer") e não
-- ganha card no CRM. A recusa da oportunidade é gravada como SAO = false.

ALTER TYPE closer_feedback_result ADD VALUE IF NOT EXISTS 'disqualified';

-- O valor novo do enum não pode ser usado como literal na mesma transação em
-- que foi criado, por isso a comparação é feita via ::text.
BEGIN;

ALTER TABLE closer_feedback_requests
  DROP CONSTRAINT IF EXISTS closer_feedback_sao_somente_se_realizada;

ALTER TABLE closer_feedback_requests
  ADD CONSTRAINT closer_feedback_sao_somente_se_realizada
  CHECK (oportunidade_qualificada IS NULL OR result::text IN ('meeting_done', 'disqualified'));

COMMIT;

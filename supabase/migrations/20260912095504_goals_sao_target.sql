-- Meta mensal de SAO (Oportunidade Aceita por Vendas) — org e por vendedor.
-- SAO = reunião realizada em que o closer respondeu "Qualificada" no feedback
-- (closer_feedback_requests.oportunidade_qualificada = true). Alimenta o card
-- grande "SAO" do Dashboard (meta + ritmo) e os rankings "SAO" / "Taxa SAO".
-- Aditiva: RLS de goals / goals_per_user (leitura da org, escrita de manager)
-- já cobre.
BEGIN;

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS sao_target integer NOT NULL DEFAULT 0;

ALTER TABLE public.goals_per_user
  ADD COLUMN IF NOT EXISTS sao_target integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.goals.sao_target IS
  'Meta mensal da org de SAO (reuniões realizadas aceitas pelo closer como oportunidade qualificada). Card "SAO" do Dashboard.';

COMMENT ON COLUMN public.goals_per_user.sao_target IS
  'Meta mensal de SAO deste vendedor (reuniões realizadas aceitas pelo closer). Coluna "ideal dia" do ranking "SAO".';

COMMIT;

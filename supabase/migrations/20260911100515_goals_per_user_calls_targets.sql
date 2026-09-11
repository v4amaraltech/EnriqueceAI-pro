-- Metas individuais de ligações por vendedor (SDR).
-- Alimentam a seção "SDR selecionado" do dashboard (cards "Total de Ligações"
-- e "Ligações Conectadas"). As metas das taxas "% de Conectadas" e
-- "Conectada p/ Marcada" são derivadas destas + meetings_scheduled_target,
-- igual ao /sdrs do Sales Hub — não têm coluna própria.
-- Aditiva: RLS de goals_per_user (leitura da org, escrita de manager) já cobre.
BEGIN;

ALTER TABLE public.goals_per_user
  ADD COLUMN IF NOT EXISTS calls_target integer NOT NULL DEFAULT 0;

ALTER TABLE public.goals_per_user
  ADD COLUMN IF NOT EXISTS calls_connected_target integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.goals_per_user.calls_target IS
  'Meta mensal de ligações (outbound, discador + Callface) deste vendedor. Card "Total de Ligações" da seção SDR selecionado.';

COMMENT ON COLUMN public.goals_per_user.calls_connected_target IS
  'Meta mensal de ligações conectadas (regra isConnectedCall, piso 50s) deste vendedor. Card "Ligações Conectadas" da seção SDR selecionado.';

COMMIT;

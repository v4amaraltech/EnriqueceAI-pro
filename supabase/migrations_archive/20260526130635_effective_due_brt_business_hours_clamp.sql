BEGIN;

-- Clamp do vencimento pro próximo horário de expediente útil (9h-18h BRT).
-- Sem isso, "atrasada" começa contar à meia-noite ou no fim de semana — o
-- dashboard de Atividades Atrasadas mostra números inflados na seg 9h porque
-- tudo que venceu sex 18h+ aparece com 39h+ overdue.
--
-- Regras BRT (America/Sao_Paulo):
--   Sáb/Dom → próxima segunda 9h
--   Antes de 9h em dia útil → 9h do mesmo dia
--   Depois de 18h em dia útil → 9h do próximo dia útil (sex 18h → seg 9h)
--   Dentro de 9h-18h em dia útil → inalterado
--
-- Espelha o helper TS effectiveDueDate em src/features/activities/utils/overdue.ts.
CREATE OR REPLACE FUNCTION public.effective_due_brt(ts timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_catalog AS $$
DECLARE
  local_ts timestamp;
  local_date date;
  hour_of_day int;
  dow int;
BEGIN
  IF ts IS NULL THEN RETURN NULL; END IF;
  local_ts := ts AT TIME ZONE 'America/Sao_Paulo';
  local_date := local_ts::date;
  hour_of_day := extract(hour from local_ts)::int;
  dow := extract(dow from local_ts)::int;

  IF dow = 6 THEN
    RETURN (local_date + interval '2 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  IF dow = 0 THEN
    RETURN (local_date + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF hour_of_day < 9 THEN
    RETURN (local_date + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF hour_of_day >= 18 THEN
    IF dow = 5 THEN
      RETURN (local_date + interval '3 days' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
    END IF;
    RETURN (local_date + interval '1 day' + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  RETURN ts;
END; $$;

COMMIT;

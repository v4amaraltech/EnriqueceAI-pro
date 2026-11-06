-- Story business-holidays (13/out/2026)
-- Feriado nacional passa a valer como fim de semana na régua de atraso e no
-- vencimento das tarefas. Em 13/10, 334 de 480 "atrasadas" tinham vencido no
-- feriado de 12/10 (Nossa Senhora Aparecida).
--
-- * public.business_holidays: lista de feriados (mesma de src/lib/utils/br-holidays.ts;
--   o teste br-holidays.test.ts confere que as duas batem).
-- * public.is_business_day_brt(date): seg–sex e não feriado. SECURITY DEFINER para
--   ler a tabela sem depender do papel de quem chama (trigger, RPC, cron).
-- * effective_due_brt / skip_weekend_brt: pulam feriado como pulam fim de semana.
--   Passam de IMMUTABLE para STABLE (agora leem tabela). Nenhum índice/visão usa as
--   duas (conferido em 13/10). Assinaturas iguais → CREATE OR REPLACE mantém grants.
-- * overdue_cutoff_brt(): corte de atraso no banco (espelho de overdueCutoff);
--   get_sdr_atividades_atrasadas_v4 (card do Sales Hub) passa a usá-lo.
BEGIN;

CREATE TABLE IF NOT EXISTS public.business_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Tabela de referência global (feriado nacional vale para todas as orgs): sem org_id.
ALTER TABLE public.business_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_holidays FROM anon, authenticated;
GRANT SELECT ON public.business_holidays TO authenticated, service_role;
DROP POLICY IF EXISTS business_holidays_read ON public.business_holidays;
CREATE POLICY business_holidays_read ON public.business_holidays
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.business_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-04-03', 'Paixão de Cristo'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-03-26', 'Paixão de Cristo'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-25', 'Natal'),
  ('2028-01-01', 'Confraternização Universal'),
  ('2028-04-14', 'Paixão de Cristo'),
  ('2028-04-21', 'Tiradentes'),
  ('2028-05-01', 'Dia do Trabalho'),
  ('2028-09-07', 'Independência do Brasil'),
  ('2028-10-12', 'Nossa Senhora Aparecida'),
  ('2028-11-02', 'Finados'),
  ('2028-11-15', 'Proclamação da República'),
  ('2028-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2028-12-25', 'Natal')
ON CONFLICT (holiday_date) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_business_day_brt(d date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT extract(dow FROM d)::int NOT IN (0, 6)
     AND NOT EXISTS (SELECT 1 FROM public.business_holidays h WHERE h.holiday_date = d);
$function$;

-- Vencimento efetivo: fora do expediente (antes de 9h, depois de 18h, fim de
-- semana ou feriado) → 9h do próximo dia útil. Espelha effectiveDueDate (overdue.ts).
CREATE OR REPLACE FUNCTION public.effective_due_brt(ts timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  local_ts timestamp;
  d date;
  h int;
  guard int := 0;
BEGIN
  IF ts IS NULL THEN RETURN NULL; END IF;
  local_ts := ts AT TIME ZONE 'America/Sao_Paulo';
  d := local_ts::date;
  h := extract(hour FROM local_ts)::int;

  IF public.is_business_day_brt(d) THEN
    IF h >= 9 AND h < 18 THEN RETURN ts; END IF;
    IF h < 9 THEN RETURN (d + time '09:00') AT TIME ZONE 'America/Sao_Paulo'; END IF;
  END IF;

  d := d + 1;
  WHILE NOT public.is_business_day_brt(d) AND guard < 30 LOOP
    d := d + 1;
    guard := guard + 1;
  END LOOP;
  RETURN (d + time '09:00') AT TIME ZONE 'America/Sao_Paulo';
END;
$function$;

-- Vencimento calculado pelo trigger calculate_next_step_due: caiu em fim de
-- semana ou feriado → 9h do próximo dia útil; em dia útil fica como está.
CREATE OR REPLACE FUNCTION public.skip_weekend_brt(ts timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  d date;
  guard int := 0;
BEGIN
  IF ts IS NULL THEN RETURN NULL; END IF;
  d := (ts AT TIME ZONE 'America/Sao_Paulo')::date;
  IF public.is_business_day_brt(d) THEN RETURN ts; END IF;

  d := d + 1;
  WHILE NOT public.is_business_day_brt(d) AND guard < 30 LOOP
    d := d + 1;
    guard := guard + 1;
  END LOOP;
  RETURN (d + time '09:00') AT TIME ZONE 'America/Sao_Paulo';
END;
$function$;

-- Corte de "atrasada" (espelha overdueCutoff em overdue.ts): 00:00 BRT do dia
-- útil mais recente cujo expediente (9h) já começou.
CREATE OR REPLACE FUNCTION public.overdue_cutoff_brt(p_now timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  loc timestamp := p_now AT TIME ZONE 'America/Sao_Paulo';
  d date := loc::date;
  guard int := 0;
BEGIN
  IF NOT public.is_business_day_brt(d) OR extract(hour FROM loc) < 9 THEN
    d := d - 1;
    WHILE NOT public.is_business_day_brt(d) AND guard < 30 LOOP
      d := d - 1;
      guard := guard + 1;
    END LOOP;
  END IF;
  RETURN d::timestamp AT TIME ZONE 'America/Sao_Paulo';
END;
$function$;

-- Card de atrasadas do Sales Hub: tinha a própria conta de corte (só fim de
-- semana). Passa a usar overdue_cutoff_brt — mesma régua do app.
CREATE OR REPLACE FUNCTION public.get_sdr_atividades_atrasadas_v4(p_org_id uuid)
 RETURNS TABLE(email text, atrasadas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  SELECT u.email::text, count(*)::bigint AS atrasadas
  FROM public.list_overdue_activities_brt(p_org_id, public.overdue_cutoff_brt()) o
  JOIN leads l ON l.id = o.lead_id
  JOIN auth.users u ON u.id = o.assigned_to
  JOIN organization_members m
    ON m.user_id = o.assigned_to AND m.org_id = l.org_id
   AND m.role = 'sdr' AND m.status IN ('active','invited')
  WHERE l.deleted_at IS NULL
    AND l.status NOT IN ('won','unqualified','archived')
  GROUP BY u.email
  ORDER BY atrasadas DESC;
$function$;

COMMIT;

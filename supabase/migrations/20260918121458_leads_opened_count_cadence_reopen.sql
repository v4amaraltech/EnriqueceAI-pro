-- "Leads abertos" passa a contar REABERTURA de lead.
--
-- Problema reportado por Giovani Olivieri (16/09/2026): ele abre lead todo dia e
-- o card não sobe. Diagnóstico: a regra antiga contava cada lead UMA ÚNICA VEZ
-- na vida, no dia do 1º toque humano. Quem trabalha fila antiga (leads
-- redistribuídos, cadência Recomendação cuja Pesquisa foi feita em maio/junho,
-- Recovery) trabalhava dezenas de leads por dia e marcava zero.
--   10/09: 30 leads trabalhados -> 0 contados (27 já tocados em jun/jul)
--   16/09: 24 leads trabalhados -> 0 contados (21 já tocados em mai/jun)
--
-- Regra nova (decidida por Vinicius em 18/09/2026): uma ABERTURA é um toque
-- humano qualificado que seja:
--   (a) o 1º toque do lead na vida            -> lead novo, igual à regra antiga; ou
--   (b) o 1º toque DEPOIS de uma nova inscrição em cadência -> REABERTURA.
-- O lead voltou para a fila e o SDR começou a trabalhar de novo: conta de novo.
--
-- Por que inscrição e não "N dias parado": a inscrição é um evento explícito do
-- processo (alguém colocou o lead na cadência), não um limiar arbitrário. Uma
-- ligação solta num lead esquecido não vira abertura; voltar o lead para a
-- esteira, sim.
--
-- Salvaguardas medidas em produção (org V4 Amaral, setembro/2026):
--   * 936 aberturas na regra nova x 695 na antiga;
--   * apenas 11 leads no mês inteiro contam 2x (reinscritos dentro do mesmo mês);
--   * 100% das 936 têm performed_by preenchido -> nenhuma abertura nasce de
--     e-mail automático de cadência. A janela exige toque, não inscrição.
--
-- Atribuição continua em leads.assigned_to (dono atual), mantendo
-- 20260522235053_leads_opened_attribute_by_assigned_to.sql.
-- Filtros herdados e mantidos: exclui notas importadas (is_note=true, ver
-- 20260601174500) e leads arquivados (ver 20260522105909).
--
-- p_cadence_ids passa a filtrar pela cadência da INSCRIÇÃO que originou a
-- abertura; para o 1º toque na vida, pela cadência do próprio toque.
--
-- Histórico: o cálculo é on-the-fly sobre interactions, então meses anteriores
-- passam a exibir o número novo automaticamente (ago/2026: 1255 -> ~1600).
-- O Sales Hub não reimplementa a regra: consome estas RPCs via n8n e grava em
-- pdi_monthly_goals — precisa de re-sync dos meses já fechados.

BEGIN;

-- Toques humanos qualificados + a janela de inscrição a que pertencem.
-- Uma linha por ABERTURA (lead novo ou reaberto).
CREATE OR REPLACE FUNCTION public.leads_opened_events(
  p_org_id uuid,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(lead_id uuid, assigned_to uuid, opened_at timestamptz, cadence_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH touches AS (
    SELECT i.lead_id, i.created_at, i.cadence_id, l.assigned_to
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
  ),
  -- (a) 1º toque do lead na vida
  first_ever AS (
    SELECT DISTINCT ON (t.lead_id)
      t.lead_id, t.assigned_to, t.created_at AS opened_at, t.cadence_id
    FROM touches t
    ORDER BY t.lead_id, t.created_at
  ),
  -- janelas de inscrição: [enrolled_at, próxima inscrição)
  windows AS (
    SELECT
      e.lead_id, e.cadence_id, e.enrolled_at,
      lead(e.enrolled_at) OVER (PARTITION BY e.lead_id ORDER BY e.enrolled_at) AS next_enrolled_at
    FROM cadence_enrollments e
    WHERE e.org_id = p_org_id
  ),
  -- (b) 1º toque dentro de cada janela de inscrição
  first_per_enrollment AS (
    SELECT DISTINCT ON (w.lead_id, w.enrolled_at)
      t.lead_id, t.assigned_to, t.created_at AS opened_at, w.cadence_id
    FROM windows w
    JOIN touches t
      ON t.lead_id = w.lead_id
     AND t.created_at >= w.enrolled_at
     AND (w.next_enrolled_at IS NULL OR t.created_at < w.next_enrolled_at)
    ORDER BY w.lead_id, w.enrolled_at, t.created_at
  ),
  all_openings AS (
    SELECT * FROM first_ever
    UNION ALL
    SELECT * FROM first_per_enrollment
  ),
  -- Filtro de cadência ANTES de deduplicar: o mesmo toque pode chegar pelos dois
  -- caminhos carregando cadence_id diferente (a do toque x a da inscrição), e
  -- qualquer um dos dois pode casar com o filtro.
  filtered AS (
    SELECT o.* FROM all_openings o
    WHERE p_cadence_ids IS NULL
       OR array_length(p_cadence_ids, 1) IS NULL
       OR o.cadence_id = ANY(p_cadence_ids)
  )
  -- Um toque = no máximo uma abertura. Sem este DISTINCT, o 1º toque da vida que
  -- também é o 1º toque da 1ª inscrição contaria 2x quando os cadence_id diferem.
  SELECT DISTINCT ON (f.lead_id, f.opened_at)
    f.lead_id, f.assigned_to, f.opened_at, f.cadence_id
  FROM filtered f
  ORDER BY f.lead_id, f.opened_at, f.cadence_id NULLS LAST;
$$;

-- Helper interno: NÃO tem guard de organização (recebe p_org_id livre), então
-- não pode ficar ao alcance de anon/authenticated. O EXECUTE de service_role vem
-- na migration seguinte (20260918122225).
REVOKE ALL ON FUNCTION public.leads_opened_events(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.assigned_to, count(*)::bigint
  FROM public.leads_opened_events(p_org_id, p_cadence_ids) e
  WHERE e.opened_at >= p_start AND e.opened_at < p_end
  GROUP BY e.assigned_to;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_leads_opened_by_sdr_daily(
  p_org_id uuid,
  p_start  timestamptz,
  p_end    timestamptz,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(performer_id uuid, opened_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'Forbidden: cannot query another organization' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.assigned_to, e.opened_at
  FROM public.leads_opened_events(p_org_id, p_cadence_ids) e
  WHERE e.opened_at >= p_start AND e.opened_at < p_end;
END;
$$;

-- CREATE OR REPLACE não mexe em ACL, mas a auditoria de 09/09 (20260909192822)
-- deixou estas duas fora da allowlist de authenticated/anon. Reafirma aqui para
-- o estado não depender da ordem de aplicação.
REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_leads_opened_by_sdr_daily(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;

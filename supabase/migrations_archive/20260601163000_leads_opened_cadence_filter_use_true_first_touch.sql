-- "Leads abertos" (count_leads_opened_by_sdr / _daily) inflava quando o
-- dashboard era filtrado por um subconjunto de cadências.
--
-- Bug: o filtro de cadência (`i.cadence_id = ANY(p_cadence_ids)`) ficava DENTRO
-- do CTE `ranked`, ANTES do ROW_NUMBER. Isso fazia o "primeiro toque" ser
-- calculado SÓ entre as interações daquelas cadências — não o primeiro toque
-- real do lead. Efeito: um lead cujo 1º contato real foi em maio (via ligação
-- sem cadência ou outra cadência) passava a contar como "aberto em junho" só
-- porque seu 1º contato DENTRO das cadências filtradas caiu em junho. Também
-- excluía do ranking interações com `cadence_id IS NULL` (ligações API4COM /
-- mensagens manuais).
--
-- Medição em prod (V4 Amaral, junho, 6 cadências ativas selecionadas):
--   sem filtro (1º toque real) = 80
--   antigo (filtro no ranking)  = 96   <- inflado ACIMA do total real
--   novo (filtro no 1º toque)   = 50   <- subconjunto correto de 80
--
-- Fix: ranquear sempre pelo PRIMEIRO TOQUE REAL do lead (sem filtro de cadência
-- no CTE) e aplicar o filtro de cadência na linha do primeiro toque (rn = 1).
-- Semântica: "leads cuja ABERTURA (1º contato humano) caiu no período E foi via
-- uma das cadências selecionadas". Filtrado é sempre subconjunto do não-filtrado;
-- nunca infla, nunca reclassifica leads entre meses por mudança de filtro.
-- Com p_cadence_ids NULL (default "Todas") o comportamento é idêntico ao anterior.

BEGIN;

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
  WITH ranked AS (
    SELECT
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
  )
  SELECT r.assigned_to, count(*)::bigint
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start AND r.created_at < p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR r.cadence_id = ANY(p_cadence_ids))
  GROUP BY r.assigned_to;
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
  WITH ranked AS (
    SELECT
      i.lead_id, l.assigned_to, i.created_at, i.cadence_id,
      ROW_NUMBER() OVER (PARTITION BY i.lead_id ORDER BY i.created_at ASC) AS rn
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
  )
  SELECT r.assigned_to, r.created_at
  FROM ranked r
  WHERE r.rn = 1
    AND r.created_at >= p_start AND r.created_at < p_end
    AND (p_cadence_ids IS NULL OR array_length(p_cadence_ids, 1) IS NULL OR r.cadence_id = ANY(p_cadence_ids));
END;
$$;

COMMIT;

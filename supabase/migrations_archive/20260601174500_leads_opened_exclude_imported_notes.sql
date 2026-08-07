-- "Leads abertos" (count_leads_opened_by_sdr / _daily) contava NOTAS IMPORTADAS
-- como o "primeiro contato humano" do lead, deflacionando a métrica.
--
-- Contexto: a lista de Reativação (clientes antigos) foi importada em lote pelo
-- usuário importacao.reativacao@v4company.com, que gravou para cada lead uma
-- interação channel='research', type='sent' com metadata {"is_note": true}
-- contendo dados de CRM (faturamento/fee), datada do dia do import (abr/mai).
-- O RPC conta research+sent como toque humano, então essas notas viravam o
-- "1º toque" do lead — marcando-o como aberto no mês do import, não no mês do
-- contato real. Reportado 2026-06-01: Guilherme abriu ~26 leads em junho mas o
-- card mostrava 1 (os outros tinham nota de import datada de abr/mai).
--
-- Escopo medido (todas as orgs do projeto): 871 notas, 798 leads, 2 orgs
-- (V4 Amaral 791 + Rosolem 7). Impacto org-wide em V4 Amaral:
--   jun  87  -> 113 (+26)   <- contato real que estava escondido
--   mai 1211 -> 905 (-306)  <- mês do import em lote, estava inflado ~25%
--   abr 494  -> 438 (-56)
--   mar 19   -> 16  (-3)
-- 346 leads (339 V4 + 7 Rosolem) saem da conta: importados/atribuídos mas
-- NUNCA realmente contatados — não eram "abertos" de fato.
--
-- Fix: excluir interações com metadata->>'is_note' = 'true' do conjunto
-- qualificado. Pesquisa REAL feita pelo SDR (dossiê/SPICED) não tem is_note e
-- segue contando. Mantém o fix anterior (filtro de cadência no 1º toque, rn=1).

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
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
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
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
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

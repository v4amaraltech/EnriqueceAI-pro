-- "Leads abertos" volta a contar SÓ LEAD NOVO: reabertura deixa de contar.
--
-- Decisão do Vinicius (15/11/2026): o indicador deve medir entrada de lead novo
-- no trabalho. Cada lead conta UMA VEZ NA VIDA, no 1º toque humano qualificado.
-- Desfaz a parte (b) de 20260918121458_leads_opened_count_cadence_reopen.sql
-- (1º toque após nova inscrição em cadência = reabertura).
--
-- Medido em prod (org V4 Amaral) com a regra anterior x esta:
--   ago/2026 1614 -> 1257 · set 1531 -> 1143 · out 1351 -> 946 · nov (até 15/11) 381 -> 283
--
-- Vale para tudo que lê leads_opened_events: card e gráfico do Dashboard, ranking
-- por SDR, painel "SDR selecionado", Taxa de Aproveitamento e o Sales Hub (via
-- n8n; meses já fechados precisam de re-sync em pdi_monthly_goals).
--
-- Mantidos: canais (phone/whatsapp/email/linkedin/research), só 'sent'/'delivered',
-- exclusão de notas importadas e de leads arquivados/sem dono, atribuição por
-- leads.assigned_to. p_cadence_ids filtra pela cadência do PRÓPRIO 1º toque
-- (igual a 20260601163000: escolhe o 1º toque da vida e só depois filtra).
--
-- Assinatura e retorno inalterados -> CREATE OR REPLACE preserva os grants
-- (service_role tem EXECUTE desde 20260918122225; anon/authenticated não).

BEGIN;

CREATE OR REPLACE FUNCTION public.leads_opened_events(
  p_org_id uuid,
  p_cadence_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(lead_id uuid, assigned_to uuid, opened_at timestamptz, cadence_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH first_ever AS (
    SELECT DISTINCT ON (i.lead_id)
      i.lead_id, l.assigned_to, i.created_at AS opened_at, i.cadence_id
    FROM interactions i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.org_id = p_org_id
      AND i.type IN ('sent', 'delivered')
      AND i.channel IN ('phone','whatsapp','email','linkedin','research')
      AND coalesce(i.metadata->>'is_note', '') <> 'true'
      AND l.status <> 'archived'
      AND l.assigned_to IS NOT NULL
    ORDER BY i.lead_id, i.created_at
  )
  SELECT f.lead_id, f.assigned_to, f.opened_at, f.cadence_id
  FROM first_ever f
  WHERE p_cadence_ids IS NULL
     OR array_length(p_cadence_ids, 1) IS NULL
     OR f.cadence_id = ANY(p_cadence_ids);
$$;

REVOKE ALL ON FUNCTION public.leads_opened_events(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_opened_events(uuid, uuid[]) TO service_role;

COMMIT;

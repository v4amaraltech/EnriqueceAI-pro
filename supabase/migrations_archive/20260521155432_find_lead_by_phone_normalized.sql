-- API4COM webhook matching de calls -> lead estava perdendo telefones
-- formatados. O fluxo antigo (external-call.service.ts: findLeadByPhoneService)
-- fazia LIKE '%suffix8' no campo `telefone` cru, mas o telefone é texto livre:
-- '(16) 99986-7577' nunca casa com '%99867577' porque o hífen quebra os 8
-- dígitos contíguos. Leads importados sem formatação (ex: '5516999867577')
-- batem, leads formatados não — ambíguo e errado.
--
-- Cenário real (V4 Amaral, 2026-05-21): SDR ligou para 016999867577, lead
-- 160e1d86 "Shap life" (telefone '(16) 99986-7577') ficou órfão e a call
-- caiu no lead errado cd36e079 "STORE SEVEN" (telefone '5516999867577' sem
-- formatação) — 87% das calls do SDR ficaram sem lead_id em 24h.
--
-- Fix: RPC find_lead_id_by_phone normaliza o telefone do lado do banco via
-- regexp_replace, compara últimos 8 dígitos, e desempata priorizando o lead
-- assigned_to o SDR que originou a call. Índice funcional torna o LIKE em
-- expressão normalizada eficiente.

BEGIN;

-- Funcional index para suportar LIKE '%<8 digitos>' em telefone normalizado.
-- text_pattern_ops é necessário para o LIKE no final da string (não suporta
-- prefix wildcard sem trigram, mas SUFFIX matching usa scan e o índice
-- ajuda no filtro auxiliar por org_id). Mantemos simples: btree comum
-- já acelera a igualdade de prefixo da expressão.
CREATE INDEX IF NOT EXISTS idx_leads_telefone_digits
  ON public.leads (org_id, regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'))
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.find_lead_id_by_phone(
  p_org_id uuid,
  p_phone_digits text,
  p_sdr_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_suffix text;
  v_lead_id uuid;
BEGIN
  -- Sanitize input: digits only, need at least 8 for a meaningful match
  v_suffix := right(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), 8);
  IF length(v_suffix) < 8 THEN
    RETURN NULL;
  END IF;

  -- Lookup priority:
  --   1. telefone (normalized) endswith suffix AND assigned_to = SDR
  --   2. phones JSONB or socios JSONB contains suffix AND assigned_to = SDR
  --   3. telefone (normalized) endswith suffix (any assigned_to), most-recently-updated
  --   4. phones JSONB or socios JSONB contains suffix, most-recently-updated
  --
  -- Steps 1-2 only fire when p_sdr_user_id is provided. The fallback (3-4)
  -- mirrors the legacy behavior so unassigned leads still surface.

  IF p_sdr_user_id IS NOT NULL THEN
    SELECT id INTO v_lead_id
    FROM leads
    WHERE org_id = p_org_id
      AND deleted_at IS NULL
      AND assigned_to = p_sdr_user_id
      AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;

    SELECT id INTO v_lead_id
    FROM leads
    WHERE org_id = p_org_id
      AND deleted_at IS NULL
      AND assigned_to = p_sdr_user_id
      AND (
        regexp_replace(phones::text, '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
        OR regexp_replace(coalesce(socios::text, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
      )
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;
  END IF;

  SELECT id INTO v_lead_id
  FROM leads
  WHERE org_id = p_org_id
    AND deleted_at IS NULL
    AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix
  ORDER BY updated_at DESC
  LIMIT 1;
  IF v_lead_id IS NOT NULL THEN RETURN v_lead_id; END IF;

  SELECT id INTO v_lead_id
  FROM leads
  WHERE org_id = p_org_id
    AND deleted_at IS NULL
    AND (
      regexp_replace(phones::text, '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
      OR regexp_replace(coalesce(socios::text, ''), '[^0-9]', '', 'g') LIKE '%' || v_suffix || '%'
    )
  ORDER BY updated_at DESC
  LIMIT 1;

  RETURN v_lead_id;
END;
$$;

-- Service-role only — called from webhook handler. Revoke from public roles.
REVOKE ALL ON FUNCTION public.find_lead_id_by_phone(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_lead_id_by_phone(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.find_lead_id_by_phone(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_lead_id_by_phone(uuid, text, uuid) TO service_role;

COMMIT;

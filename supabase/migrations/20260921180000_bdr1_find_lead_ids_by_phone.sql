-- BDR-1 (lado Enriquece) — fonte central de bloqueios consultada pelo V4 Call
-- imediatamente antes de discar (GET /api/v1/contacts/holds?telefone=).
-- Por quê: find_lead_id_by_phone devolve UM lead (para vincular ligação); aqui
-- basta um lead do telefone ter recusa para bloquear, então precisamos de TODOS.
-- Casamento por sufixo de 11 dígitos (DDD + número) ou 10 (fixo / sem o 9º
-- dígito), sobre o telefone normalizado no banco; também olha `phones` JSONB.

CREATE OR REPLACE FUNCTION public.find_lead_ids_by_phone(
  p_org_id uuid,
  p_phone_digits text
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_digits text;
  v_s11 text;
  v_s10 text;
BEGIN
  v_digits := regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 10 THEN
    RETURN;
  END IF;
  v_s11 := right(v_digits, 11);
  v_s10 := right(v_digits, 10);

  RETURN QUERY
  SELECT id
  FROM leads
  WHERE org_id = p_org_id
    AND deleted_at IS NULL
    AND (
      right(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 11) = v_s11
      OR right(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 10) = v_s10
      OR regexp_replace(coalesce(phones::text, ''), '[^0-9]', '', 'g') LIKE '%' || v_s11 || '%'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.find_lead_ids_by_phone(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_lead_ids_by_phone(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_lead_ids_by_phone(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_lead_ids_by_phone(uuid, text) TO service_role;

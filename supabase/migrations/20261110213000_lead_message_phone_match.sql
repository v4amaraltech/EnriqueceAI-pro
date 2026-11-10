BEGIN;

-- Casa o telefone recebido com qualquer número em lead_contacts da mesma org.
-- Só o service role executa. Não altera leads nem interactions.

CREATE OR REPLACE FUNCTION public.match_lead_contacts_by_phone(p_org_id uuid, p_variants text[])
RETURNS TABLE(lead_id uuid, lead_contact_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.lead_id, c.id
  FROM public.lead_contacts c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.phones, '[]'::jsonb)) AS p(item)
  WHERE c.org_id = p_org_id
    AND regexp_replace(COALESCE(p.item->>'numero', p.item->>'number', ''), '\D', '', 'g') = ANY (p_variants);
$$;

REVOKE ALL ON FUNCTION public.match_lead_contacts_by_phone(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_lead_contacts_by_phone(uuid, text[]) TO service_role;

COMMIT;

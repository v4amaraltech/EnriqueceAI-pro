-- Correções de segurança HIGH (pistas 3 e 14 da auditoria). Idempotente, forward-only.
--
-- Pista 3: ingest_callface_call e enriquecer_lead executáveis por anon/public.
--   Sem checagem do chamador e com escrita em dados de qualquer org. Passam a ser
--   executáveis só por service_role (n8n e jobs usam a chave service_role).
-- Pista 14: lead_contacts aceitava lead_id de outra org e as funções DEFINER
--   espelhavam/trocavam o contato principal sem conferir a org do lead.

BEGIN;

-- 1. Pista 3: REVOKE em todas as sobrecargas, GRANT só para service_role --------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ingest_callface_call', 'enriquecer_lead')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 2. Pista 14: helper para checar a org do lead (ignora RLS de leads) ------------
CREATE OR REPLACE FUNCTION public.lead_belongs_to_user_org(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND l.org_id = public.user_org_id()
  );
$$;

REVOKE ALL ON FUNCTION public.lead_belongs_to_user_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_belongs_to_user_org(uuid) TO authenticated, service_role;

-- 3. RLS: org do contato E org do lead precisam ser a do usuário ---------------
DROP POLICY IF EXISTS lead_contacts_org ON public.lead_contacts;
CREATE POLICY lead_contacts_org ON public.lead_contacts FOR ALL
  USING (org_id = public.user_org_id())
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.lead_belongs_to_user_org(lead_id)
  );

-- 4. Espelhamento: só atualiza o lead se ele pertencer à mesma org do contato ---
CREATE OR REPLACE FUNCTION public.sync_primary_contact_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_lead_id uuid := COALESCE(NEW.lead_id, OLD.lead_id);
  v_p       public.lead_contacts%ROWTYPE;
  v_email   text;
  v_tel     text;
BEGIN
  SELECT * INTO v_p
  FROM public.lead_contacts
  WHERE lead_id = v_lead_id AND is_primary = true
  LIMIT 1;

  IF v_p.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e ->> 'email' INTO v_email
  FROM jsonb_array_elements(COALESCE(v_p.emails, '[]'::jsonb)) e
  WHERE COALESCE(trim(e ->> 'email'), '') <> ''
  LIMIT 1;

  SELECT p ->> 'numero' INTO v_tel
  FROM jsonb_array_elements(COALESCE(v_p.phones, '[]'::jsonb)) p
  WHERE COALESCE(trim(p ->> 'numero'), '') <> ''
  LIMIT 1;

  UPDATE public.leads l SET
    first_name          = v_p.first_name,
    last_name           = v_p.last_name,
    job_title           = v_p.job_title,
    emails              = v_p.emails,
    phones              = v_p.phones,
    email               = v_email,
    telefone            = v_tel,
    email_bounced_at    = CASE WHEN v_email IS DISTINCT FROM l.email THEN NULL ELSE l.email_bounced_at END,
    whatsapp_invalid_at = CASE WHEN v_tel   IS DISTINCT FROM l.telefone THEN NULL ELSE l.whatsapp_invalid_at END
  WHERE l.id = v_lead_id
    AND l.org_id = v_p.org_id;

  RETURN NULL;
END;
$$;

-- 5. set_primary_lead_contact: confere a org do contato e a do lead ---------------
CREATE OR REPLACE FUNCTION public.set_primary_lead_contact(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_lead_id uuid;
  v_org_id  uuid;
  v_user_org uuid := public.user_org_id();
BEGIN
  IF v_user_org IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT lead_id, org_id INTO v_lead_id, v_org_id
  FROM public.lead_contacts WHERE id = p_contact_id;

  IF v_lead_id IS NULL THEN
    RETURN;
  END IF;

  IF v_org_id IS DISTINCT FROM v_user_org THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = v_lead_id AND l.org_id = v_user_org
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.lead_contacts
    SET is_primary = false
    WHERE lead_id = v_lead_id AND org_id = v_user_org
      AND is_primary = true AND id <> p_contact_id;

  UPDATE public.lead_contacts
    SET is_primary = true
    WHERE id = p_contact_id AND org_id = v_user_org;
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_lead_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_lead_contact(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

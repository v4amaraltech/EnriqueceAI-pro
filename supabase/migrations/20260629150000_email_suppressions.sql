-- M9 (Auditoria cadência de e-mail, 29/jun): unsubscribe / supressão LGPD.
-- Quando um titular pede para não receber mais e-mails (List-Unsubscribe ou link
-- no rodapé), o endereço é suprimido por ORG. A supressão vale para o E-MAIL,
-- não para um registro de lead específico — assim um re-import do mesmo e-mail
-- (noutro lead) continua suprimido. O motor de cadência consulta esta tabela e
-- não envia para endereços suprimidos (marca o enrollment como 'unsubscribed').
--
-- A escrita acontece via service_role (endpoint público /api/unsubscribe, sem
-- sessão), por isso não há policy de INSERT para usuários — só leitura org-scoped
-- + gestão manual pelo manager.

BEGIN;

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- Lead que originou o unsubscribe (informativo; a supressão é por e-mail).
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'unsubscribe',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE email_suppressions IS
  'Endereços suprimidos por org (unsubscribe/LGPD). A cadência não envia para estes e-mails. Ver M9 / docs/qa/cadence-email-audit-2026-06-29.md.';

-- Supressão é por (org, e-mail) case-insensitive — dedup e lookup rápido no envio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_org_email
  ON email_suppressions (org_id, lower(email));

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da org veem as supressões da própria org.
DROP POLICY IF EXISTS "email_suppressions_select" ON email_suppressions;
CREATE POLICY "email_suppressions_select" ON email_suppressions
  FOR SELECT USING (org_id = public.user_org_id());

-- Gestão manual (remover uma supressão por engano): manager-only. A INSERÇÃO
-- automática do unsubscribe usa service_role (bypassa RLS).
DROP POLICY IF EXISTS "email_suppressions_insert" ON email_suppressions;
CREATE POLICY "email_suppressions_insert" ON email_suppressions
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND public.is_manager());

DROP POLICY IF EXISTS "email_suppressions_delete" ON email_suppressions;
CREATE POLICY "email_suppressions_delete" ON email_suppressions
  FOR DELETE USING (org_id = public.user_org_id() AND public.is_manager());

COMMIT;

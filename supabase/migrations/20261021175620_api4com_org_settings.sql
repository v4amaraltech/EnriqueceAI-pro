-- Story api4com-embedded-webphone (bloco 1): token da API4COM no nível da
-- organização + colunas de sincronização de ramais.
--
-- Antes: cada SDR cadastrava o próprio token em `api4com_connections`. Agora o
-- gestor cadastra UM token (conta pai, `ttl: -1`) em `api4com_org_settings`;
-- o ramal de cada SDR continua em `api4com_connections` e é preenchido pela
-- sincronização com `GET /extensions` (casa por ramal para quem já tem linha e
-- por e-mail para quem não tem). `api_key_encrypted` por usuário vira legado:
-- só é usado quando a org não tem token.
BEGIN;

CREATE TABLE IF NOT EXISTS api4com_org_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT 'https://api.api4com.com/api/v1/',
  -- Domínio da conta (ex.: v4amaral.api4com.com). Vem do `domain` dos ramais.
  sip_domain TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE api4com_org_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON api4com_org_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON api4com_org_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Só gestor escreve; qualquer membro lê (o token nunca é selecionado pelo app
-- com o cliente do usuário — só o service role descriptografa).
DROP POLICY IF EXISTS "managers manage api4com org settings" ON api4com_org_settings;
CREATE POLICY "managers manage api4com org settings"
  ON api4com_org_settings FOR ALL
  USING (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()))
  WITH CHECK (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

DROP POLICY IF EXISTS "members read api4com org settings" ON api4com_org_settings;
CREATE POLICY "members read api4com org settings"
  ON api4com_org_settings FOR SELECT
  USING (org_id = (SELECT public.user_org_id()));

-- Rastro da sincronização por ramal.
ALTER TABLE api4com_connections ADD COLUMN IF NOT EXISTS api4com_extension_id TEXT;
ALTER TABLE api4com_connections ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

COMMIT;

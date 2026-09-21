-- BDR-3 — E-mail conversacional (plano docs/bdr/plano-bdr-ia.md do V4 Call, §7.1)
-- Por quê: o detector de respostas (check-email-replies) para de olhar o par
-- cadência/lead depois da primeira `replied` — serve para entregar ao SDR, não
-- para sustentar uma conversa. Aqui entram: bloqueios com finalidade
-- (contact_holds), ingestão contínua da caixa (email_inbound), estado próprio
-- da conversa com lock por executor (email_conversations) e intenção
-- persistente de resposta (email_reply_intents). `replied` encerra a
-- prospecção, não a escuta.
BEGIN;

-- ── Bloqueios com finalidade (BDR-1, lado Enriquece) ─────────────────────────
CREATE TABLE IF NOT EXISTS contact_holds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('prospeccao', 'conversa', 'total')),
  origem      TEXT NOT NULL DEFAULT 'sistema',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_holds_lead_tipo ON contact_holds (lead_id, tipo);
CREATE INDEX IF NOT EXISTS idx_contact_holds_org ON contact_holds (org_id);
ALTER TABLE contact_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_holds_org ON contact_holds;
CREATE POLICY contact_holds_org ON contact_holds FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());

-- ── Caixas do BDR IA: cursor de ingestão, teto diário, pausa ─────────────────
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS bdr_ai BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS history_id TEXT;
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS last_processed_internal_date TIMESTAMPTZ;
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS daily_cap INTEGER;
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS paused_reason TEXT;

-- ── Mensagens recebidas (identidade única por caixa + mensagem) ──────────────
CREATE TABLE IF NOT EXISTS email_inbound (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mailbox_user_id   UUID NOT NULL,
  gmail_message_id  TEXT NOT NULL,
  thread_id         TEXT,
  rfc_message_id    TEXT,
  in_reply_to       TEXT,
  from_email        TEXT,
  subject           TEXT,
  snippet           TEXT,
  body_text         TEXT,
  internal_date     TIMESTAMPTZ,
  kind              TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (kind IN ('lead', 'own', 'auto_reply', 'bounce', 'unknown')),
  lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id   UUID,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_inbound_mailbox_msg ON email_inbound (mailbox_user_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_email_inbound_conversation ON email_inbound (conversation_id, internal_date);
CREATE INDEX IF NOT EXISTS idx_email_inbound_org ON email_inbound (org_id);
ALTER TABLE email_inbound ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_inbound_org ON email_inbound;
CREATE POLICY email_inbound_org ON email_inbound FOR SELECT USING (org_id = public.user_org_id());

-- ── Estado próprio da conversa + lock por executor ───────────────────────────
CREATE TABLE IF NOT EXISTS email_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  mailbox_user_id     UUID NOT NULL,
  thread_id           TEXT NOT NULL,
  estado              TEXT NOT NULL DEFAULT 'ia_ativa'
                      CHECK (estado IN ('ia_ativa', 'aguardando_lead', 'humano_assumiu', 'encerrada')),
  lock_until          TIMESTAMPTZ,
  lock_owner          TEXT,
  ultima_msg_lead_at  TIMESTAMPTZ,
  ultima_msg_ia_at    TIMESTAMPTZ,
  humano_user_id      UUID,
  trocas_sem_avanco   INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_conversations_lead_thread ON email_conversations (lead_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_email_conversations_org_estado ON email_conversations (org_id, estado);
ALTER TABLE email_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_conversations_org ON email_conversations;
CREATE POLICY email_conversations_org ON email_conversations FOR ALL
  USING (org_id = public.user_org_id()) WITH CHECK (org_id = public.user_org_id());
DROP TRIGGER IF EXISTS set_updated_at ON email_conversations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Intenção persistente de resposta (saída) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS email_reply_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES email_conversations(id) ON DELETE CASCADE,
  responde_a        UUID[] NOT NULL DEFAULT '{}',
  rfc_message_id    TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'rascunho'
                    CHECK (estado IN ('rascunho', 'enviando', 'enviada', 'incerta', 'falhou')),
  gmail_message_id  TEXT,
  subject           TEXT,
  body_html         TEXT,
  erro              TEXT,
  tentativas        INTEGER NOT NULL DEFAULT 0,
  owner             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_reply_intents_rfc ON email_reply_intents (rfc_message_id);
CREATE INDEX IF NOT EXISTS idx_email_reply_intents_estado ON email_reply_intents (estado, updated_at);
ALTER TABLE email_reply_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_reply_intents_org ON email_reply_intents;
CREATE POLICY email_reply_intents_org ON email_reply_intents FOR SELECT USING (org_id = public.user_org_id());
DROP TRIGGER IF EXISTS set_updated_at ON email_reply_intents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_reply_intents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Lock atômico da conversa: um executor por vez, com dono e renovação ──────
CREATE OR REPLACE FUNCTION claim_email_conversation(p_id UUID, p_owner TEXT, p_lease_seconds INTEGER DEFAULT 300)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows INTEGER;
BEGIN
  UPDATE email_conversations
     SET lock_owner = p_owner,
         lock_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE id = p_id
     AND (lock_until IS NULL OR lock_until < now() OR lock_owner = p_owner);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION renew_email_conversation_lock(p_id UUID, p_owner TEXT, p_lease_seconds INTEGER DEFAULT 300)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows INTEGER;
BEGIN
  UPDATE email_conversations
     SET lock_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   WHERE id = p_id AND lock_owner = p_owner AND lock_until >= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION release_email_conversation_lock(p_id UUID, p_owner TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows INTEGER;
BEGIN
  UPDATE email_conversations
     SET lock_owner = NULL, lock_until = NULL, updated_at = now()
   WHERE id = p_id AND lock_owner = p_owner;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- ── Crons: ingestão 24/7 (não envia) e conciliação de intenções ──────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-email-inbox') THEN
    PERFORM cron.unschedule('ingest-email-inbox');
  END IF;
  PERFORM cron.schedule(
    'ingest-email-inbox',
    '*/5 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://app.enriqueceai.com.br/api/cron/ingest-email-inbox',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-email-reply-intents') THEN
    PERFORM cron.unschedule('reconcile-email-reply-intents');
  END IF;
  PERFORM cron.schedule(
    'reconcile-email-reply-intents',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://app.enriqueceai.com.br/api/cron/reconcile-email-reply-intents',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), 'REPLACE_ME'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;

COMMIT;

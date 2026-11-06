-- BDR-3 — ingestor da caixa: dois tipos novos em email_inbound.kind
--   calendar  = convite/aceite/recusa de agenda (nunca vira conversa)
--   unrelated = e-mail de lead fora de thread iniciado por nós (auditoria, sem conversa)
-- Coluna é TEXT: não altera os tipos gerados (src/lib/supabase/types.ts).
BEGIN;

ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS email_inbound_kind_check;
ALTER TABLE email_inbound ADD CONSTRAINT email_inbound_kind_check
  CHECK (kind IN ('lead', 'own', 'auto_reply', 'bounce', 'calendar', 'unrelated', 'unknown'));

COMMIT;

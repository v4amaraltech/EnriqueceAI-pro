BEGIN;

-- Conversa só de leitura no histórico do lead (WhatsApp e e-mail).
-- Flag nasce desligada. Nada muda no histórico enquanto lead_channel_chat
-- estiver desligada para a organização. Não aplica sozinha em produção.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'lead_channel_chat',
  false,
  'Conversa de WhatsApp e e-mail no histórico do lead, só leitura. Desligada: o histórico segue a linha do tempo. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas).',
  '{}',
  '{}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

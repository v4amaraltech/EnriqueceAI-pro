-- Meeting reminder follow-up — passos WhatsApp (WhatsApp-first inbound), INATIVOS.
--
-- Desenho aprovado (produto):
--   INBOUND : no ato = email + WhatsApp | T-24h = WhatsApp | T-1h = WhatsApp
--   OUTBOUND: no ato = email + WhatsApp | T-24h = email    | T-2h = email
--
-- Aqui só INSERIMOS os passos WhatsApp com active=false. Enquanto inativos, a
-- v_reminders_due não devolve nenhuma linha whatsapp (inerte). step_order na
-- faixa 11+ para não colidir com os passos de email (UNIQUE(context, step_order)).
--
-- ===========================================================================
-- ATIVAÇÃO (rodar SÓ após sign-off de produto + jurídico/LGPD) — NÃO executar aqui:
--   BEGIN;
--   -- liga os passos WhatsApp
--   UPDATE public.reminder_steps SET active = true
--     WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
--       AND channel = 'whatsapp' AND step_order IN (11,12,13);
--   -- WhatsApp-first: desliga os 2 emails de reforço do inbound (T-24h e T-1h)
--   UPDATE public.reminder_steps SET active = false
--     WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
--       AND context = 'inbound' AND channel = 'email' AND step_order IN (2,3);
--   COMMIT;
-- ===========================================================================
-- Forward-only, idempotente.

INSERT INTO public.reminder_steps
  (org_id, context, step_order, anchor, offset_minutes, channel, message_template_id, active)
SELECT
  v.org_id::uuid, v.context, v.step_order, v.anchor, v.offset_minutes, 'whatsapp',
  (SELECT id FROM public.message_templates mt
   WHERE mt.org_id = v.org_id::uuid AND mt.name = v.tpl_name),
  false
FROM (VALUES
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 11,'on_book',     0,'Lembrete Reunião WA — Confirmação'),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 12,'meeting', -1440,'Lembrete Reunião WA — Reconfirmação 24h'),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','inbound', 13,'meeting',   -60,'Lembrete Reunião WA — Lembrete final'),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b','outbound',11,'on_book',     0,'Lembrete Reunião WA — Confirmação')
) AS v(org_id, context, step_order, anchor, offset_minutes, tpl_name)
ON CONFLICT (org_id, context, step_order) DO NOTHING;

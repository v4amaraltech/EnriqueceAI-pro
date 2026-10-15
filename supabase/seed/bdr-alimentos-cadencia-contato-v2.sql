-- BDR — Cadência "BDR IA — Indústrias de Alimentos (contato v2 — e-mail primeiro)". Rodar UMA vez por org,
-- substituindo :org_id, :created_by e :email_cadence_id (a cadência "BDR IA — Arroz (e-mail auto)").
-- Precisa da migração 20261015120000 (bdr_cadence_links + claim_due_steps com e-mail primeiro).
-- APLICADO na org V4 em 15/10/2026: cadência c1bf4745-6c1f-40ff-9d21-3c383798a9cd, vinculada à e26829e2… (janela 7 dias).
--
-- Dias úteis (o gatilho set_next_step_due põe 9h BRT e pula fim de semana):
--   dia 0  E-mail 1 (cadência de e-mail, inscrição automática pelo vínculo)
--   dia 1  Ligação 1 manhã (celular) + tarde (celular, outro número)
--   dia 4  Ligação 2 manhã (celular) + tarde pela RECEPÇÃO (fixo da empresa, se houver; senão celular)
--   dia 8  Ligação 3 manhã (celular) + tarde pela RECEPÇÃO (fixo, se houver; senão celular)
-- Só liga quem abriu/clicou/respondeu e-mail nos últimos 7 dias. Quem nunca abriu sai sem ligação.
-- O executor n8n reconhece "recepção" em activity_name e usa lead_telefone_fixo com contexto.via_recepcao.
BEGIN;

WITH c AS (
  INSERT INTO cadences (org_id, name, description, status, total_steps, created_by, priority, origin, type, auto_loss_after_days, sdr_switch_allowed, executor)
  VALUES (:'org_id', 'BDR IA — Indústrias de Alimentos (contato v2 — e-mail primeiro)',
          'Ligações da Ana IA (V4 Call) só para quem abriu e-mail. Dias 1, 4 e 8; tarde pela recepção quando há fixo.',
          'active', 6, :'created_by', 'high', 'outbound', 'standard', 21, false, 'bdr_ai')
  RETURNING id
),
s AS (
  INSERT INTO cadence_steps (cadence_id, step_order, channel, delay_days, delay_hours, activity_name, instructions, ai_personalization)
  SELECT c.id, 1, 'phone'::channel_type, 1, 0, 'Ligação 1 — Ana IA (manhã 10-12h)', NULL, false FROM c
  UNION ALL SELECT c.id, 2, 'phone'::channel_type, 0, 0, 'Ligação 1 — Ana IA (tarde 14-17h, outro número)', NULL, false FROM c
  UNION ALL SELECT c.id, 3, 'phone'::channel_type, 3, 0, 'Ligação 2 — Ana IA (manhã 10-12h)', NULL, false FROM c
  UNION ALL SELECT c.id, 4, 'phone'::channel_type, 0, 0, 'Ligação 2 — Ana IA (tarde, pela recepção: fixo da empresa)',
    'LIGAÇÃO PELA RECEPÇÃO: este número é o fixo da empresa, quem atende é a recepção ou outra pessoa. Peça para falar com a pessoa pelo nome. Se perguntarem o assunto: "é sobre o comercial, ele vai saber". Não apresente a oferta à recepção. Se a pessoa não puder atender, pergunte o melhor horário e se existe ramal ou número direto, agradeça e encerre. Se transferirem, siga o roteiro normal a partir da apresentação.', false FROM c
  UNION ALL SELECT c.id, 5, 'phone'::channel_type, 4, 0, 'Ligação 3 — Ana IA (manhã 10-12h, última)', NULL, false FROM c
  UNION ALL SELECT c.id, 6, 'phone'::channel_type, 0, 0, 'Ligação 3 — Ana IA (tarde, pela recepção: fixo da empresa, última)',
    'LIGAÇÃO PELA RECEPÇÃO: este número é o fixo da empresa, quem atende é a recepção ou outra pessoa. Peça para falar com a pessoa pelo nome. Se perguntarem o assunto: "é sobre o comercial, ele vai saber". Não apresente a oferta à recepção. Se a pessoa não puder atender, pergunte o melhor horário e se existe ramal ou número direto, agradeça e encerre. Se transferirem, siga o roteiro normal a partir da apresentação.', false FROM c
  RETURNING cadence_id
)
INSERT INTO bdr_cadence_links (phone_cadence_id, email_cadence_id, org_id, janela_abertura_dias)
SELECT DISTINCT cadence_id, :'email_cadence_id'::uuid, :'org_id'::uuid, 7 FROM s;

COMMIT;

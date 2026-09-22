-- BDR-5 — Cadências "BDR IA — Arroz" (plano §3). Rodar UMA vez por org, substituindo :org_id e :created_by.
-- Duas cadências inscritas juntas pela API: (contato) standard com passos phone (dono = caixa Ana IA);
-- (e-mail auto) auto_email com 4 templates. Dias em dias úteis via delay_days (o motor pula fim de semana).
BEGIN;

WITH t1 AS (
  INSERT INTO message_templates (org_id, name, channel, subject, body, created_by) VALUES
  (:'org_id', 'BDR Arroz — E-mail 1 (apresentação)', 'email', 'Previsibilidade de vendas na {{empresa}}',
   '<p>Olá {{primeiro_nome}},</p><p>Sou a Ana, da V4 Company. Trabalhamos com indústrias de alimentos que querem mais previsibilidade de vendas e diversificação de canais, com posicionamento forte para o sell-in no varejo e no atacado.</p><p>Faz sentido conversarmos 30 minutos sobre como a {{empresa}} está estruturando a geração de demanda para os próximos meses?</p><p>{{nome_vendedor}}<br>V4 Company</p>', :'created_by'),
  (:'org_id', 'BDR Arroz — E-mail 2 (case)', 'email', 'Re: Previsibilidade de vendas na {{empresa}}',
   '<p>{{primeiro_nome}}, complementando: em indústrias de alimentos com distribuição regional, o que mais destrava previsibilidade é combinar posicionamento de marca com ativação de canais (varejo, atacado e food service) em ciclos curtos, medidos por sell-in e sell-out.</p><p>Posso te mostrar como isso foi feito em um caso parecido com o da {{empresa}}?</p><p>{{nome_vendedor}}</p>', :'created_by'),
  (:'org_id', 'BDR Arroz — E-mail 3 (pergunta direta)', 'email', 'Re: Previsibilidade de vendas na {{empresa}}',
   '<p>{{primeiro_nome}}, uma pergunta só: hoje a maior dor comercial da {{empresa}} está em abrir canais novos ou em vender mais nos canais atuais?</p><p>Sua resposta me ajuda a preparar algo útil para uma conversa rápida.</p><p>{{nome_vendedor}}</p>', :'created_by'),
  (:'org_id', 'BDR Arroz — E-mail 4 (encerramento)', 'email', 'Re: Previsibilidade de vendas na {{empresa}}',
   '<p>{{primeiro_nome}}, não vou insistir. Se em algum momento fizer sentido revisar a estratégia comercial da {{empresa}}, é só responder este e-mail.</p><p>Obrigada pela atenção.<br>{{nome_vendedor}}</p>', :'created_by')
  RETURNING id, name
),
c1 AS (
  INSERT INTO cadences (org_id, name, description, status, total_steps, created_by, priority, origin, type, auto_loss_after_days, sdr_switch_allowed, executor)
  VALUES (:'org_id', 'BDR IA — Arroz (contato)', 'Ligações da Ana IA (V4 Call). Passos phone executados pelo n8n via claim_due_steps.', 'active', 4, :'created_by', 'high', 'outbound', 'standard', 21, false, 'bdr_ai')
  RETURNING id
),
c2 AS (
  INSERT INTO cadences (org_id, name, description, status, total_steps, created_by, priority, origin, type, auto_loss_after_days, sdr_switch_allowed, executor)
  VALUES (:'org_id', 'BDR IA — Arroz (e-mail auto)', 'E-mails automáticos da Ana IA (caixas bdr_ai). Respostas vão para o agente de e-mail.', 'active', 4, :'created_by', 'high', 'outbound', 'auto_email', NULL, false, 'bdr_ai')
  RETURNING id
)
INSERT INTO cadence_steps (cadence_id, step_order, channel, delay_days, delay_hours, activity_name, template_id, reply_type, ai_personalization)
SELECT c1.id, 1, 'phone', 0, 0, 'Ligação 1 — Ana IA (10-12h)', NULL, NULL, false FROM c1
UNION ALL SELECT c1.id, 2, 'phone', 1, 0, 'Ligação 2 — Ana IA (14-17h, outro número)', NULL, NULL, false FROM c1
UNION ALL SELECT c1.id, 3, 'phone', 3, 0, 'Ligação 3 — Ana IA', NULL, NULL, false FROM c1
UNION ALL SELECT c1.id, 4, 'phone', 6, 0, 'Ligação 4 — Ana IA (última)', NULL, NULL, false FROM c1
UNION ALL SELECT c2.id, 1, 'email', 0, 0, 'E-mail 1', (SELECT id FROM t1 WHERE name LIKE '%E-mail 1%'), NULL, true FROM c2
UNION ALL SELECT c2.id, 2, 'email', 3, 0, 'E-mail 2', (SELECT id FROM t1 WHERE name LIKE '%E-mail 2%'), 'reply', false FROM c2
UNION ALL SELECT c2.id, 3, 'email', 4, 0, 'E-mail 3', (SELECT id FROM t1 WHERE name LIKE '%E-mail 3%'), 'reply', false FROM c2
UNION ALL SELECT c2.id, 4, 'email', 6, 0, 'E-mail 4', (SELECT id FROM t1 WHERE name LIKE '%E-mail 4%'), 'reply', false FROM c2;

COMMIT;
-- Dias da cadência (dias úteis): ligações 0, 1, 4, 10; e-mails 0, 3, 7, 13.

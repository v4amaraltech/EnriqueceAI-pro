-- Meeting reminder follow-up — F3: templates de email (DRAFT, sujeito a sign-off
-- de marketing/comercial) + link para reminder_steps.
--
-- Variáveis (fornecidas pelo worker na F4, convenção alinhada aos templates de cadência):
--   {{primeiro_nome}}       nome do lead                (lead-sourced → escapar)
--   {{empresa}}             razão social / nome fantasia (lead-sourced → escapar)
--   {{nome_vendedor}}       nome do SDR (assigned_to via auth.users)
--   {{data_reuniao}}        data por extenso em America/Sao_Paulo
--   {{hora_reuniao}}        hora HH:MM em America/Sao_Paulo
--   {{link_reuniao_linha}}  bloco HTML da linha do link, ou '' quando sem Meet
--
-- Render (F4): corpo com escapeHtml:false; worker pré-escapa os valores
-- lead-sourced e valida meet_link como URL https. Forward-only, idempotente.

-- 1. Inserir templates (guarda por org_id+name) ------------------------------
INSERT INTO public.message_templates (org_id, name, channel, subject, body, variables_used, is_system, created_by)
SELECT v.org_id, v.name, 'email'::channel_type, v.subject, v.body, v.vars, false, NULL
FROM (VALUES
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Inbound 1 · Confirmação',
   'Reunião confirmada — {{data_reuniao}} às {{hora_reuniao}}',
   E'<p>Oi {{primeiro_nome}}, tudo bem?</p>\n<p>Sua reunião com a V4 está confirmada! 🎉</p>\n<p><strong>📅 {{data_reuniao}}</strong><br><strong>🕒 {{hora_reuniao}} (horário de Brasília)</strong></p>\n{{link_reuniao_linha}}\n<p>No nosso papo eu vou entender o seu momento e te mostrar, na prática, como podemos ajudar a bater suas metas de crescimento. Separe uns 30 minutos sem interrupção que rende bastante.</p>\n<p>Qualquer imprevisto, é só responder este e-mail. Até lá!</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','nome_vendedor','data_reuniao','hora_reuniao','link_reuniao_linha']),

  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Inbound 2 · Reconfirmação 24h',
   'Amanhã: nossa reunião às {{hora_reuniao}}',
   E'<p>Oi {{primeiro_nome}}, tudo certo?</p>\n<p>Passando para confirmar nossa reunião de <strong>{{data_reuniao}}</strong>, às <strong>{{hora_reuniao}}</strong> (horário de Brasília).</p>\n{{link_reuniao_linha}}\n<p>Continua de pé para você? Se precisar ajustar o horário, é só me responder que a gente reencaixa.</p>\n<p>Te espero lá!</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','nome_vendedor','data_reuniao','hora_reuniao','link_reuniao_linha']),

  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Inbound 3 · Lembrete final 1h',
   'Começamos em 1 hora — {{hora_reuniao}}',
   E'<p>Oi {{primeiro_nome}}!</p>\n<p>Nossa reunião é daqui a pouco, às <strong>{{hora_reuniao}}</strong> (horário de Brasília).</p>\n{{link_reuniao_linha}}\n<p>Já deixo o acesso aqui para facilitar. Nos vemos em instantes!</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','nome_vendedor','hora_reuniao','link_reuniao_linha']),

  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Outbound 1 · Confirmação',
   'Reunião agendada — {{empresa}} e V4 em {{data_reuniao}}',
   E'<p>Olá {{primeiro_nome}}, tudo bem?</p>\n<p>Obrigado pela conversa — nossa reunião está agendada.</p>\n<p><strong>📅 {{data_reuniao}}</strong><br><strong>🕒 {{hora_reuniao}} (horário de Brasília)</strong></p>\n{{link_reuniao_linha}}\n<p>A ideia do encontro é mostrar, com base no cenário da {{empresa}}, como estruturar uma operação de crescimento previsível e rentável. Vou chegar com exemplos concretos do seu segmento.</p>\n<p>Se surgir qualquer imprevisto, me avise por aqui que reagendamos. Até {{data_reuniao}}!</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','empresa','nome_vendedor','data_reuniao','hora_reuniao','link_reuniao_linha']),

  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Outbound 2 · Valor 24h',
   'Amanhã: o que preparei para {{empresa}}',
   E'<p>Olá {{primeiro_nome}},</p>\n<p>Nossa reunião é amanhã, <strong>{{data_reuniao}}</strong> às <strong>{{hora_reuniao}}</strong> (horário de Brasília), e queria adiantar por que vale o seu tempo.</p>\n<p>Empresas como a {{empresa}} costumam deixar receita na mesa por depender de canais pouco previsíveis. Vou te mostrar como transformar isso em uma máquina de aquisição mensurável — com casos reais do seu setor.</p>\n{{link_reuniao_linha}}\n<p>Continua de pé? Se precisar remarcar, é só responder.</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','empresa','nome_vendedor','data_reuniao','hora_reuniao','link_reuniao_linha']),

  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião — Outbound 3 · Lembrete final 2h',
   'Daqui a 2 horas: nossa reunião ({{hora_reuniao}})',
   E'<p>Olá {{primeiro_nome}},</p>\n<p>Lembrete rápido: nossa reunião é daqui a 2 horas, às <strong>{{hora_reuniao}}</strong> (horário de Brasília).</p>\n{{link_reuniao_linha}}\n<p>Deixo o acesso aqui para facilitar. Até já!</p>\n<p>{{nome_vendedor}}<br>V4 Company</p>',
   ARRAY['primeiro_nome','nome_vendedor','hora_reuniao','link_reuniao_linha'])
) AS v(org_id, name, subject, body, vars)
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_templates mt
  WHERE mt.org_id = v.org_id::uuid AND mt.name = v.name
);

-- 2. Ligar cada passo ao seu template ----------------------------------------
UPDATE public.reminder_steps rs
SET message_template_id = mt.id
FROM public.message_templates mt
WHERE mt.org_id = rs.org_id
  AND rs.org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND mt.name = CASE
    WHEN rs.context='inbound'  AND rs.step_order=1 THEN 'Lembrete Reunião — Inbound 1 · Confirmação'
    WHEN rs.context='inbound'  AND rs.step_order=2 THEN 'Lembrete Reunião — Inbound 2 · Reconfirmação 24h'
    WHEN rs.context='inbound'  AND rs.step_order=3 THEN 'Lembrete Reunião — Inbound 3 · Lembrete final 1h'
    WHEN rs.context='outbound' AND rs.step_order=1 THEN 'Lembrete Reunião — Outbound 1 · Confirmação'
    WHEN rs.context='outbound' AND rs.step_order=2 THEN 'Lembrete Reunião — Outbound 2 · Valor 24h'
    WHEN rs.context='outbound' AND rs.step_order=3 THEN 'Lembrete Reunião — Outbound 3 · Lembrete final 2h'
  END;

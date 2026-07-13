-- Seed da cadência "Reativação Inbound — Ismael" (org V4 Company Amaral).
--
-- Snapshot versionado de uma cadência criada via MCP em produção (13/07/2026):
-- 1 sequência de reativação de leads inbound perdidos, 8 passos manuais
-- (5 ligações + 3 WhatsApp) distribuídos em 4 dias. O SDR inscreve os leads.
--
-- Características importantes deste seed:
--   * GUARDADO: só roda se a org e o usuário (Ismael) existirem. Em ambientes
--     novos (local/CI) onde eles não existem, o seed se pula sozinho — evita
--     falha por FK. Em produção, as linhas já existem e o ON CONFLICT (id)
--     DO NOTHING torna a reexecução um no-op. Ou seja: é documentação fiel,
--     nunca sobrescreve o que está no banco.
--   * `delay_days` é o DIA ABSOLUTO da cadência menos 1 (Dia N -> delay_days = N-1);
--     passos do mesmo dia compartilham o mesmo delay_days; a ordem vem de step_order.
--   * Passos phone/whatsapp são MANUAIS (fila de Atividades do SDR dono do lead).
--     O remetente/executor efetivo é o SDR; `created_by` = Ismael (dono da cadência).

BEGIN;

DO $seed$
DECLARE
  v_org  uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';  -- V4 Company Amaral
  v_user uuid := 'dcb4b327-caa7-4e13-b072-67a46c143ddc';  -- Ismael Dobelin
  v_cad  uuid := 'cc517626-eccd-4a55-83f6-d81d4085d240';
  v_wa1  uuid := '0e158448-e84b-420b-b492-8a46aefb8ed9';
  v_wa2  uuid := '4e2dc8bd-ab59-4bf2-a6ce-85cddcc0d9ba';
  v_wa3  uuid := '8feb5ae4-33b4-4586-aa54-5a8c72b85f2d';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
    RAISE NOTICE 'Seed "Reativação Inbound — Ismael" pulado: org/usuário ausentes (ambiente não-produção).';
    RETURN;
  END IF;

  -- Templates de WhatsApp
  INSERT INTO message_templates (id, org_id, name, channel, subject, body, variables_used, is_system, created_by)
  VALUES
    (v_wa1, v_org, 'Reativação Inbound — WhatsApp 1 (reabertura)', 'whatsapp', NULL,
     $b$Oi {{primeiro_nome}}, tudo bem? Aqui é o {{nome_vendedor}}, da V4 Company. Você chegou até a gente interessado em marketing e vendas pra {{empresa}} e acabamos não conseguindo seguir na época. Voltei porque acho que vale a pena retomar 🙂 Mudou alguma coisa aí nos últimos meses? Se fizer sentido, te mando rapidinho o que a gente tem feito por negócios parecidos com o seu.$b$,
     ARRAY['primeiro_nome','nome_vendedor','empresa'], false, v_user),
    (v_wa2, v_org, 'Reativação Inbound — WhatsApp 2 (follow-up)', 'whatsapp', NULL,
     $b$ {{primeiro_nome}}, tudo certo? Só passando pra saber se faz sentido a gente conversar agora ou se prefere que eu te procure mais pra frente. Se não for o momento, sem problema nenhum — é só me avisar. Fico à disposição! — {{nome_vendedor}}, V4 Company$b$,
     ARRAY['primeiro_nome','nome_vendedor'], false, v_user),
    (v_wa3, v_org, 'Reativação Inbound — WhatsApp 3 (retomar)', 'whatsapp', NULL,
     $b$Oi {{primeiro_nome}}, tudo bem? Tentei falar com você algumas vezes por aqui e por ligação 😅 Não quero insistir à toa, então vou ser direto: faz sentido a gente retomar a conversa sobre o marketing e as vendas da {{empresa}}? Se sim, me diz um horário bom que eu te ligo. Se não for o momento, é só me avisar que eu paro por aqui e te procuro mais pra frente. Abraço! — {{nome_vendedor}}, V4 Company$b$,
     ARRAY['primeiro_nome','empresa','nome_vendedor'], false, v_user)
  ON CONFLICT (id) DO NOTHING;

  -- Cadência (status espelha produção: paused; para inscrever leads precisa estar active)
  INSERT INTO cadences (id, org_id, name, description, status, total_steps, priority, origin, type, created_by)
  VALUES (
    v_cad, v_org, 'Reativação Inbound — Ismael',
    'Reativação de leads inbound (Blackbox/Leadbroker) perdidos por motivos reativáveis. 1 ligação + 2 WhatsApp, todos manuais. O SDR inscreve os leads.',
    'paused', 8, 'high', 'inbound_active', 'standard', v_user
  )
  ON CONFLICT (id) DO NOTHING;

  -- Passos (8), distribuídos em 4 dias, no máximo 1 WhatsApp por dia
  INSERT INTO cadence_steps (id, cadence_id, step_order, channel, template_id, delay_days, delay_hours, ai_personalization, activity_name, instructions)
  VALUES
    ('f32bb864-14f8-4502-8453-aa6f650d1380', v_cad, 1, 'phone',    NULL,  0, 0, false, 'Ligação 1 — Reabertura',
     $i$Ligação de reativação — lead inbound que buscou a V4 e esfriou. Objetivo: reabrir a conversa. Roteiro: (1) apresente-se e lembre que ele buscou a V4 pra empresa dele; (2) pergunte o que mudou / o que travou desde então; (3) ofereça um diagnóstico rápido de marketing e vendas; (4) havendo interesse, agende a reunião com o closer. Não atendeu? Sem estresse — o WhatsApp de reabertura entra 2 dias depois.$i$),
    ('bca692f0-445d-4326-aef4-844b21e9a88f', v_cad, 2, 'whatsapp', v_wa1, 0, 0, false, 'WhatsApp 1 — Reabertura', NULL),
    ('38b553b8-9fb7-4019-85bf-0950a10ad4e9', v_cad, 3, 'phone',    NULL,  1, 0, false, 'Ligação 2 — Retomada',
     $i$2ª tentativa de contato. Se não atendeu antes, varie o horário e reforce que você também mandou WhatsApp. Objetivo: reabrir a conversa e entender o momento atual do negócio.$i$),
    ('52db8d1d-31c8-4aac-a275-a475d9a3fbae', v_cad, 4, 'whatsapp', v_wa2, 1, 0, false, 'WhatsApp 2 — Follow-up', NULL),
    ('54a12ed9-b2ea-45cc-8e97-9ab2a4d421e0', v_cad, 5, 'phone',    NULL,  2, 0, false, 'Ligação 3 — Diagnóstico',
     $i$3ª tentativa. Se conseguir falar, foque em diagnóstico: o que mudou desde o primeiro contato, o que está travando marketing e vendas hoje. Puxe para uma reunião com o closer.$i$),
    ('eb0ac10c-8d25-4b1b-ac50-52b3ce39d07a', v_cad, 6, 'phone',    NULL,  2, 0, false, 'Ligação 4 — Nova tentativa',
     $i$4ª tentativa. Varie o horário (manhã x fim de tarde). Se cair na caixa, o WhatsApp "faz sentido retomarmos?" entra logo em seguida.$i$),
    ('cd50d5a0-f816-4b72-ae32-ac8e93aaa780', v_cad, 7, 'whatsapp', v_wa3, 3, 0, false, 'WhatsApp 3 — Faz sentido retomarmos?', NULL),
    ('a704ab55-5e32-4e2e-8a74-8c159146d678', v_cad, 8, 'phone',    NULL,  3, 0, false, 'Ligação 5 — Última tentativa',
     $i$Última tentativa de ligação. Seja direto: "tentei te contatar algumas vezes, faz sentido seguirmos?". Sem resposta após esta, avaliar dar o lead como perdido novamente com o motivo adequado.$i$)
  ON CONFLICT (id) DO NOTHING;

END $seed$;

COMMIT;

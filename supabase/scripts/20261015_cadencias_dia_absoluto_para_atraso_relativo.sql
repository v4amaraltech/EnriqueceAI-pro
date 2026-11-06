-- NÃO É MIGRATION. Script manual, de uma vez só — rodar só com aprovação do usuário
-- e DEPOIS do deploy da tela nova (TimelineBuilder/CadenceBuilder gravando atraso
-- relativo). Se rodar antes, a tela antiga regrava dia absoluto no próximo "Salvar".
--
-- Por quê: o motor (calculate_next_step_due) trata cadence_steps.delay_days como
-- atraso RELATIVO ao passo anterior, mas a tela antiga gravava o DIA ABSOLUTO - 1.
-- As cadências abaixo foram montadas na tela (delay_days nunca diminui) e rodam
-- esticadas. Ex.: Recovery planejada até o Dia 7 executa até o dia ~21
-- (mediana medida em interactions); Inbound 2.0 planejada até o Dia 18 somaria
-- 159 dias.
--
-- O que faz: delay_days := delay_days - delay_days do passo anterior.
-- Leads em andamento: o vencimento do passo atual (next_step_due) não muda;
-- só os passos seguintes passam a vencer no dia planejado.
--
-- Fora de propósito:
--  * auto_email (o construtor de e-mail já grava "aguardar X dias", relativo);
--  * 'BDR IA — Indústrias de Alimentos (contato)' 26d84d91: a ordem dos passos
--    parece ter sido embaralhada por um salvamento na tela antiga (ligações 3–6
--    executaram nos dias 4, 7, 14, 21, intercaladas com 7–10). Decidir à parte;
--  * cadências já relativas (v3 rascunho 78aa84ca, contato v2 c1bf4745).
--
-- Guarda: só converte cadência que AINDA tem delay_days sem diminuir (rodar de
-- novo não converte duas vezes as que já viraram relativas).

BEGIN;

WITH alvo(cadence_id) AS (
  VALUES
    ('15a05299-1627-40d1-be81-80150a4f1308'::uuid), -- Recovery
    ('180fd01a-3e20-44b1-a0cc-098e60feb227'::uuid), -- Prospecção Fria
    ('3c3de4ea-94b8-476c-a0e1-4bbfc26891c9'::uuid), -- Inbound 2.0
    ('a4a16384-aa9e-415c-b54d-ca27e8435991'::uuid), -- Indústrias de Cabos Elétricos
    ('04a8c66d-f7d2-4d0f-bd3d-4dea06fe4c61'::uuid), -- Final Setembro
    ('196cf0f5-fb6b-4dad-96cc-8793d3798c21'::uuid), -- EMBALAGENS T1 (dono)
    ('f468a241-cd0f-4392-94b0-0f0c58c8615e'::uuid), -- EMBALAGENS T2/T3 (diretoria)
    ('fcf381e9-84ea-4dad-94c2-bee236f04ac9'::uuid), -- Prospecção industrias
    ('4a64c9c9-94f1-4abc-997e-2ffbb02aab19'::uuid), -- Recomendação
    ('06976c72-0ec6-427f-8d11-cb5ae7220312'::uuid), -- Recovery Lucas
    ('6d6a313c-87b8-4fad-be34-c73d02bda7cd'::uuid), -- Outbound Escolas
    ('f38821b7-d957-4bc8-8e62-4490c28a5a76'::uuid), -- Prospecção Agro — Contato (SDR)
    ('cc517626-eccd-4a55-83f6-d81d4085d240'::uuid), -- Reativação Inbound — Ismael
    ('72ac8667-057e-44fb-9c4d-4ecd114b3917'::uuid), -- Outbound Nathanael
    ('997087ce-b854-4ce2-9c21-01c426e9808f'::uuid), -- Reativação
    ('f5a7d1d9-9d16-4511-b530-c0ad07492764'::uuid)  -- Inbound
),
passos AS (
  SELECT cs.id, cs.cadence_id, cs.delay_days,
         lag(cs.delay_days) OVER (PARTITION BY cs.cadence_id ORDER BY cs.step_order) AS anterior
  FROM cadence_steps cs
  JOIN alvo a ON a.cadence_id = cs.cadence_id
  JOIN cadences c ON c.id = cs.cadence_id AND c.type::text = 'standard'
),
ainda_absoluta AS (
  SELECT cadence_id FROM passos
  GROUP BY cadence_id
  HAVING bool_and(anterior IS NULL OR delay_days >= anterior)
)
UPDATE cadence_steps cs
SET delay_days = p.delay_days - coalesce(p.anterior, 0)
FROM passos p
JOIN ainda_absoluta x ON x.cadence_id = p.cadence_id
WHERE cs.id = p.id;

-- Conferência antes do COMMIT: cada cadência deve somar (delay_days) o último
-- "Dia" planejado menos 1 (Recovery = 6, Inbound 2.0 = 17, Prospecção Fria = 9 ...).
SELECT c.name, sum(cs.delay_days) AS ultimo_dia_menos_1,
       string_agg(cs.delay_days::text, ',' ORDER BY cs.step_order) AS delays
FROM cadence_steps cs JOIN cadences c ON c.id = cs.cadence_id
WHERE cs.cadence_id IN (SELECT cadence_id FROM (VALUES
    ('15a05299-1627-40d1-be81-80150a4f1308'::uuid), ('180fd01a-3e20-44b1-a0cc-098e60feb227'::uuid),
    ('3c3de4ea-94b8-476c-a0e1-4bbfc26891c9'::uuid), ('a4a16384-aa9e-415c-b54d-ca27e8435991'::uuid),
    ('04a8c66d-f7d2-4d0f-bd3d-4dea06fe4c61'::uuid), ('196cf0f5-fb6b-4dad-96cc-8793d3798c21'::uuid),
    ('f468a241-cd0f-4392-94b0-0f0c58c8615e'::uuid), ('fcf381e9-84ea-4dad-94c2-bee236f04ac9'::uuid),
    ('4a64c9c9-94f1-4abc-997e-2ffbb02aab19'::uuid), ('06976c72-0ec6-427f-8d11-cb5ae7220312'::uuid),
    ('6d6a313c-87b8-4fad-be34-c73d02bda7cd'::uuid), ('f38821b7-d957-4bc8-8e62-4490c28a5a76'::uuid),
    ('cc517626-eccd-4a55-83f6-d81d4085d240'::uuid), ('72ac8667-057e-44fb-9c4d-4ecd114b3917'::uuid),
    ('997087ce-b854-4ce2-9c21-01c426e9808f'::uuid), ('f5a7d1d9-9d16-4511-b530-c0ad07492764'::uuid)
  ) v(cadence_id))
GROUP BY c.name ORDER BY c.name;

COMMIT; -- trocar por ROLLBACK para ensaiar

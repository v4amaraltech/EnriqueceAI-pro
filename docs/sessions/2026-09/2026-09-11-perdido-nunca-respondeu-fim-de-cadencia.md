# 2026-09-11 — Lead vira Perdido "Nunca respondeu" quando a cadência termina

## Origem
Pedido do Vini: quando aparecer "Cadência concluída — todos os passos foram executados", o lead deve virar **Perdido** com o motivo **"Nunca respondeu"**.

Antes, o fim da cadência só gravava o evento na timeline. O Perdido chegava pelo `expire-inactive-leads` só **21 dias** depois da última atividade (regra da story `cadence-end-auto-loss`, de 09/set). Até lá o lead ficava parado em "Contatado".

## Diagnóstico
- A mensagem é gravada em 3 pontos, todos quando a RPC `advance_enrollment_after_step` devolve `completed`:
  - `execute-activity.ts`: SDR executa o último passo;
  - `execute-cadence.ts`: o motor envia o último e-mail;
  - `skip-step.ts`: SDR pula o último passo (mensagem "último passo pulado pelo SDR").
- `cadence_enrollments.status = 'completed'` **não** serve de gatilho: nos últimos 30 dias, a maioria dos `completed` veio de triagem de limbo, perda manual e troca de cadência. Um trigger no banco daria Perdido errado.
- Os 2 fechamentos de exceção do motor (`no_step` e reprocessamento idempotente) não gravam o evento e ficaram de fora.
- A "Inbound — E-mail (auto)" roda **em paralelo** com a "Inbound 2.0". Sem proteção, o fim do e-mail daria Perdido com o SDR ainda trabalhando o lead (57 casos em 30 dias).

## Decisões do Vini
1. Recovery termina → **"Deixou de responder"**. Evita o loop Recovery → Perdido → Recovery, porque esse motivo não está entre os que reativam.
2. Lead inbound perdido por "Nunca respondeu" → segue a recuperação de inbound (Recovery 30 dias depois), igual ao Perdido manual.
3. **Só daqui pra frente**, sem correção retroativa. Os ~130 parados seguem a regra dos 21 dias.

## Implementação
- Service novo `src/features/cadences/services/cadence-end-loss.service.ts` → `markLeadLostOnCadenceEnd({ orgId, leadId, cadenceId, enrollmentId })`:
  - usa o service role e **nunca lança** (falha não quebra o passo);
  - proteções: status `new`/`contacted` (revalidado no próprio UPDATE), nenhuma outra cadência `active`/`paused`, nenhum `scheduled_activities` pendente, motivo existente na org (`ilike`, sem diferenciar maiúsculas);
  - efeitos iguais ao `markLeadAsLost`: evento `lead_lost` na timeline antes do UPDATE (com `metadata.reason = 'cadence_completed_no_reply'` e `performed_by` nulo), lead `unqualified` com motivo e observação "Cadência concluída sem resposta", motivo carimbado no enrollment (só se vazio), webhook `lead.unqualified` e `scheduleInboundRecovery`.
- `inbound-recovery.service.ts`: exporta `getInboundRecoveryCadenceId(orgId)`, que identifica a Recovery da org.
- Chamada com `await` nos 3 pontos.
- 18 testes novos. typecheck ✅ lint ✅ 2010 testes ✅ build ✅.

## Simulação em prod (só leitura, 30 dias)
- 132 perderiam: 60 "Nunca respondeu" (58 da "Inbound — E-mail (auto)" e 2 da "Inbound") e 72 "Deixou de responder" (Recovery).
- 57 ficam por ter outra cadência aberta.
- 37 ficam por status (qualificado, ganho ou já perdido).

## Entrega
- PR [#390](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/390): squash `17d727c7` às 10:00 UTC, **no ar** às 10:03 UTC (`/api/version`).
- PR [#391](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/391): story → **Done** (`4aeab5bd`).
- PR [#395](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/395): teste manual registrado na story (`a0d12a3c`).
- Sem migration.

## Teste manual em prod ✅ (10:18 UTC)
1. Lead de teste `51fa8081` criado via SQL, em Contatado e sem origem inbound, na Prospecção Fria no passo 15/15.
2. Executado pela fila de Atividades (Chrome logado como Vini) com "Enviado manualmente".
3. Resultado: lead `unqualified` "Nunca respondeu", enrollment com o motivo, e a timeline "WhatsApp 15 (Manual) → Cadência concluída → Lead perdido". Sem Recovery.
4. Lead de teste soft-deletado às 10:20 UTC.

**Não testado em prod** (só teste unitário): fim da Recovery, inbound indo para a Recovery e as proteções.

## ⭐ Lições
- **O CI caiu 2× no flaky "Closing rpc while fetch was pending"** (`inbound-lead.service.test.ts`), com os 2010 testes passando. `gh run rerun <id> --failed` resolve. Vale uma story para acabar com esse flaky.
- Depois do **"Enviado manualmente"**, a tela avança sozinha para o **próximo lead real** da fila. Em teste em prod, fechar a tela antes de clicar em qualquer coisa.
- O "Enviado manualmente" só libera com texto no campo da mensagem.
- O checkout principal está com **staged deletions** de arquivos já mesclados (story/gate `conversion-analytics-rpc`, migration `20260911030704`, `read-all-rows.ts`, `tests/mocks/postgrest-table.ts`…). Todo o trabalho foi feito em worktree para não misturar. **Conferir antes de qualquer commit no checkout principal.**

## Próximos passos
- Avisar o gestor: a taxa de perda "Nunca respondeu" sobe nos gráficos já em setembro (antes chegava 21 dias depois).
- Acompanhar os primeiros fins de cadência reais, principalmente da "Inbound — E-mail (auto)" e da Recovery. Consulta: `interactions` com `metadata->>'reason' = 'cadence_completed_no_reply'`.
- Opcional: incluir os 2 fechamentos de exceção do motor, se aparecer lead parado vindo deles.
- Resolver o estado do checkout principal (`git status` com staged deletions) e dar `git pull` na `main`.

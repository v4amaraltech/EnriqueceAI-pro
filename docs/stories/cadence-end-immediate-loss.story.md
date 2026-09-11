# Story: Perdido "Nunca respondeu" na hora em que a cadência termina

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @qa (Quinn) | **Teste manual em prod OK** (10:18 UTC, Chrome logado como Vini). Lead de teste `51fa8081` criado via SQL na Prospecção Fria, passo 15/15, executado com "Enviado manualmente" → lead Perdido "Nunca respondeu". Lead de teste soft-deletado às 10:20 UTC. Detalhes em QA Results. |
| 2026-09-11 | @devops (Gage) | Ready for Review → **Done** a pedido do Vini. PR #390 mergeado (squash `17d727c7`, 10:00 UTC) e **no ar** às 10:03 UTC (`/api/version` = `17d727c`). CI verde (1ª rodada caiu no flaky conhecido "Closing rpc while fetch was pending" em `inbound-lead.service.test.ts`, 2010 testes passando; re-run verde). Teste manual em prod ainda não feito. |
| 2026-09-11 | @dev (Dex) | Implementado + testado. typecheck ✅ lint ✅ 2010 testes ✅ (+18 novos) build ✅. Nada commitado (regra git manual). |
| 2026-09-11 | Vini + Claude | Story criada a pedido do Vini. Decisões: Recovery → "Deixou de responder"; inbound segue a regra da Recovery (igual ao perdido manual); só vale daqui pra frente (sem correção retroativa). |

## Story

**As a** gestor de SDRs,
**I want** que o lead vire Perdido com o motivo "Nunca respondeu" assim que a cadência termina (todos os passos executados),
**so that** o lead não fique parado 21 dias em "Contatado" esperando o auto-perda por inatividade.

## Contexto

Antes: ao concluir a cadência só ficava o evento "Cadência concluída — todos os passos foram executados" na timeline. O Perdido só vinha pelo `expire-inactive-leads` (21 dias sem atividade, story `cadence-end-auto-loss`). Essa regra continua valendo para os leads antigos e para cadências encerradas por outros caminhos.

## Acceptance Criteria

1. Quando a cadência conclui pelo último passo (execução manual do SDR, e-mail automático do motor ou último passo pulado), o lead vira `unqualified` com motivo **"Nunca respondeu"** e observação "Cadência concluída sem resposta".
2. Na cadência **Recovery** o motivo é **"Deixou de responder"** (evita loop Recovery → perdido → Recovery).
3. O lead **não** é tocado se: status diferente de Novo/Contatado; tem outra cadência aberta (ativa/pausada); tem retorno agendado pendente; a org não tem o motivo cadastrado.
4. Mesmos efeitos do perdido manual: evento `lead_lost` na timeline, motivo no enrollment concluído, webhook `lead.unqualified` e recuperação automática de inbound.
5. Falha na regra nunca quebra a execução do passo.

## Scope

**IN:** service `markLeadLostOnCadenceEnd` + chamada nos 3 pontos que registram "Cadência concluída".

**OUT:** correção retroativa dos ~130 leads já parados; os 2 fechamentos de exceção do motor (`no_step` / reprocessamento idempotente), que não registram o evento; notificação ao gestor (o auto-perda de 21 dias também não notifica).

## Tasks

- [x] `getInboundRecoveryCadenceId(orgId)` exportado da Recovery
- [x] Service `cadence-end-loss.service.ts` com as proteções do AC3
- [x] Chamada em `execute-activity.ts`, `execute-cadence.ts` e `skip-step.ts`
- [x] Testes (18)
- [x] Simulação em prod (leitura) nos fins de cadência dos últimos 30 dias: 132 perderiam (58 "Inbound — E-mail (auto)" + 2 "Inbound" com "Nunca respondeu"; 72 Recovery com "Deixou de responder"); 57 ficariam por ter outra cadência aberta; 37 ficariam por status

## Risks

- Taxa de perda por "Nunca respondeu" sobe nos gráficos já no mês do deploy (antes vinha 21 dias depois).
- Leads inbound perdidos por "Nunca respondeu" entram na fila da Recovery 30 dias depois (mesma regra do perdido manual).

## Dev Agent Record

### File List
- `src/features/cadences/services/cadence-end-loss.service.ts` (novo)
- `src/features/cadences/services/cadence-end-loss.service.test.ts` (novo)
- `src/features/leads/services/inbound-recovery.service.ts`
- `src/features/activities/actions/execute-activity.ts`
- `src/features/activities/actions/skip-step.ts`
- `src/features/cadences/actions/execute-cadence.ts`
- `docs/stories/cadence-end-immediate-loss.story.md` (novo)

## QA Results
Sem gate formal. Evidências: 18 testes novos cobrindo os AC1–AC5, suíte completa verde no CI, simulação em prod (leitura) nos últimos 30 dias, deploy verificado por `/api/version`.

### Teste manual em prod — 2026-09-11 10:18 UTC ✅

**Roteiro:** lead de teste `51fa8081` "TESTE QA Perdido fim de cadência (pode apagar)" criado via SQL — status Contatado, sem origem inbound, responsável Vini, inscrito na **Prospecção Fria** no passo 15/15 (último, WhatsApp). Na tela de Atividades (Chrome logado como Vini): Executar → mensagem de teste → **Enviado manualmente** (nada foi enviado de verdade).

| Verificação | Resultado |
|---|---|
| Status do lead | `unqualified` (Perdido; botão "Reabrir" aparece) ✅ |
| Motivo / observação no lead | "Nunca respondeu" / "Cadência concluída sem resposta" ✅ |
| Enrollment | `completed`, mesmo motivo e observação ✅ |
| Timeline | WhatsApp 15 (Manual) → "Cadência concluída — todos os passos foram executados" → "Lead marcado como perdido — Motivo: Nunca respondeu \| Cadência concluída sem resposta" (evento do sistema, `performed_by` vazio) ✅ |
| Recuperação de inbound | Não agendou (lead não é inbound), como esperado ✅ |

**Limpeza:** lead de teste soft-deletado (`deleted_at` 10:20 UTC); sem enrollment aberto nem retorno pendente. As interactions do teste ficam — contam 1 atividade e 1 perdido para o Vini só em 11/set.

**Não testado em prod** (coberto só por teste unitário): fim da Recovery com "Deixou de responder", lead inbound indo para a Recovery, e as proteções de outra cadência aberta / retorno agendado.

**Observação de UX:** depois do "Enviado manualmente", a tela avança sozinha para o próximo lead real da fila.

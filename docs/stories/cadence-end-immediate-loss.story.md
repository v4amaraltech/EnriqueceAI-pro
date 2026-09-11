# Story: Perdido "Nunca respondeu" na hora em que a cadência termina

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
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
_(pendente)_

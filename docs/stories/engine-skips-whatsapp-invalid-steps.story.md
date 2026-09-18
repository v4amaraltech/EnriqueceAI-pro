# Story: Motor pula passos de WhatsApp de lead sem WhatsApp

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-18 | @dev (Dex) | Implementado + testado. typecheck ✅ lint ✅ 2144 testes ✅ (+13 novos) build ✅. |
| 2026-09-18 | Vini + Claude | Story criada. Achado ao revisar a carga de Recovery: 235 inscrições ativas paradas em passo de WhatsApp de lead marcado. Vini escolheu a opção 1 (motor pula os passos). |

## Origem

A fila (`fetch-pending-activities.ts`) **esconde** passos de WhatsApp de lead com `whatsapp_invalid_at`, mas o `current_step` da inscrição não andava: ela ficava ativa num passo que ninguém vê. `reportWhatsAppInvalid` já pula os WhatsApp no momento em que o SDR avisa — o que não cobre quem foi marcado **antes** de entrar na cadência (Recovery, troca de cadência, novo enrollment).

**Escala (18/set, org V4):** 413 inscrições ativas de leads marcados, **235 paradas em passo de WhatsApp** — 105 com passo de outro canal esperando (destraváveis) e 130 sem nenhum canal restante. Fora da Recovery, mais 9 destraváveis.

Dívida antiga, anotada desde 03/set ("motor pular WA em `whatsapp_invalid_at`").

## Story

**As a** SDR,
**I want** que a cadência ande sozinha quando o lead não tem WhatsApp,
**so that** o próximo passo de ligação ou e-mail apareça na minha fila em vez do lead ficar invisível.

## Acceptance Criteria

1. Inscrição **ativa** de lead com `whatsapp_invalid_at`, parada num passo de WhatsApp: o motor avança para o **próximo passo de outro canal**.
2. Sequência de WhatsApp seguidos é pulada de uma vez (vai direto ao primeiro passo de outro canal).
3. Sem passo de outro canal depois, **nada muda** — não pausa nem encerra (pausar em massa criaria pilha invisível; decisão do Vini).
4. Passo atual que não é WhatsApp, ou `current_step` fora da faixa (sobra de edição de cadência): não mexe.
5. Cada avanço grava `step_skipped_whatsapp_invalid` na timeline, com `from_step`/`to_step`.
6. Teto de 50 avanços por execução; leitura em lote maior e ordenada por `enrolled_at`, para a fila drenar por inteiro.
7. Falha não quebra o motor (loga e segue).

## Scope

**IN:** service novo chamado como pré-passo de `executeStepsCore`, testes.

**OUT:** os 130 sem canal restante (proposta 2 — Perdido "Contatos inválidos" — fica para outra story); pausadas sem data já existentes (22 em 18/set); mudança na fila (ela já esconde os passos).

## Tasks
- [x] `whatsapp-invalid-skip.service.ts` com `nextNonWhatsAppStep` (pura) + `skipWhatsAppStepsForInvalidLeads`
- [x] Pré-passo em `execute-cadence.ts`, depois da ativação de agendadas
- [x] 13 testes
- [ ] Conferir em prod depois do deploy (esperado: ~114 avanços nas primeiras execuções)

## Risks

| Risco | Mitigação |
|---|---|
| Avanço em massa enche a fila dos SDRs de uma vez | teto de 50 por execução; o vencimento é recalculado pelo trigger (`delay_days`), então não cai tudo hoje |
| Lead volta a ter WhatsApp válido depois | marcação é por lead (`whatsapp_invalid_at`); limpar o campo faz os passos voltarem a aparecer |
| Corrida com o SDR executando o mesmo passo | `UPDATE` com trava otimista (`eq('current_step', atual)`) |

## Dev Agent Record

### File List
- `src/features/cadences/services/whatsapp-invalid-skip.service.ts` (novo)
- `src/features/cadences/services/whatsapp-invalid-skip.service.test.ts` (novo)
- `src/features/cadences/actions/execute-cadence.ts`
- `docs/stories/engine-skips-whatsapp-invalid-steps.story.md` (novo)

### Notas
- O teto de leitura (`WHATSAPP_SCAN_LIMIT = 500`) existe porque a maioria dos candidatos não está em passo de WhatsApp: lendo só 50 sem ordenação, o motor varreria sempre as mesmas inscrições e nunca alcançaria o resto (achado na própria implementação).
- O motor roda a cada 5 min em horário comercial, então 50 avanços/execução drenam os ~114 no mesmo dia.

## QA Results
_(pendente)_

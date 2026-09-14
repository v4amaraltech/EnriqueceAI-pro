# Story: "Não é WhatsApp" não tira o lead da cadência

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-14 | @dev (Dex) | Implementado + testado. typecheck ✅ lint ✅ 2082 testes ✅ (+6 novos) build ✅. |
| 2026-09-14 | Vini + Claude | Story criada. Achado no acompanhamento da regra `cadence-end-immediate-loss`: o botão encerrava a cadência. Vini: "esse botão não era para remover o lead da cadência". Decisão: **pausar** a inscrição; reabrir os 2 leads em limbo. |

## Origem

No acompanhamento de 14/set apareceu 1 lead (`130546eb`, Recovery passo 7, Guilherme) em "Contatado sem cadência", sem rastro nenhum na timeline. Causa: `report-whatsapp-invalid.ts` **encerrava** o enrollment (`status='completed'`) quando não sobrava passo de outro canal.

Isso contraria o AC 5 da story `activity-skip-guardrails`: "o lead recebe a marcação de WhatsApp inválido e **a cadência avança**". Encerrar também escapa da regra de Perdido no fim da cadência (`cadence-end-immediate-loss`), porque esse caminho não grava o evento `cadence_completed` — o lead saía sem cadência, sem motivo e sem evento.

**Escala:** 11 enrollments encerrados por esse caminho desde jun/2026 (2 em jun, 4 em jul, 1 em ago, 4 em set), 2 ainda em limbo em 14/set.

## Story

**As a** SDR,
**I want** que avisar "Não é WhatsApp" só marque o contato como inválido,
**so that** o lead continue na cadência em vez de desaparecer da minha fila.

## Acceptance Criteria

1. Havendo passo de outro canal depois do atual, o enrollment avança para ele (comportamento atual, inalterado).
2. Não havendo, o enrollment fica **`paused`** — nunca `completed`.
3. A pausa grava evento `cadence_paused` na timeline com `metadata.reason = 'whatsapp_invalid'`.
4. O dono do lead recebe notificação dizendo o que fazer (atualizar telefone ou trocar de cadência).
5. O lead continua marcado com `whatsapp_invalid_at` e a tentativa falha continua registrada.
6. Falha ao pausar devolve erro tratado, sem deixar o enrollment em estado inconsistente.

## Scope

**IN:** `report-whatsapp-invalid.ts` (pausa + rastro + aviso), testes, reabertura dos 2 leads em limbo.

**OUT:** motor pular passos de WhatsApp de lead marcado (dívida antiga); auto-perda de enrollment `paused` (hoje o cron só olha `active` e `completed`); mostrar o passo na fila com aviso (opção 2, descartada pelo Vini).

## Tasks

- [x] Pausar em vez de encerrar, com `handleQueryError`
- [x] Evento `cadence_paused` + notificação ao dono do lead
- [x] 6 testes (avança, pausa, último passo, rastro, aviso, input inválido)
- [x] Reabrir os 2 leads em limbo — feito 14/set, backup `_bkp_wa_invalid_reopen_20260914`: enrollments `93a74c27` (lead `130546eb`) e `b6e644b6` (lead `a6e29be5`) voltaram para `paused` (`completed_at` nulo) + evento na timeline. ⚠️ `b6e644b6` está em `current_step = 10` e a Recovery tem 7 passos (sobra da edição da cadência) — pausado não incomoda, mas não anda se for retomado

## Risks

- Enrollment `paused` não é alcançado pelo auto-perda (cron olha `active`/`completed`) nem pelo alerta de limbo. Se acumular, vira story própria — hoje são ~2/mês.

## Dev Agent Record

### File List
- `src/features/activities/actions/report-whatsapp-invalid.ts`
- `src/features/activities/actions/report-whatsapp-invalid.test.ts` (novo)
- `docs/stories/whatsapp-invalid-keeps-enrollment.story.md` (novo)

## QA Results
_(pendente)_

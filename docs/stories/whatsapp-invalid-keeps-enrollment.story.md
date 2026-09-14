# Story: "Não é WhatsApp" não tira o lead da cadência

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-14 | @dev (Dex) | **No ar:** PR #418 mergeado (squash `0b1d782e`, 22:48 UTC), `/api/version` = `0b1d782` às 22:52 UTC, CI verde de primeira. Ajuste extra a pedido do Vini: enrollment `b6e644b6` fora da faixa → passo 6 + reativado (ver Dev Agent Record, nota 2). |
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
- [x] Reabrir os 2 leads em limbo — feito 14/set, backup `_bkp_wa_invalid_reopen_20260914`: enrollments `93a74c27` (lead `130546eb`) e `b6e644b6` (lead `a6e29be5`) voltaram para `paused` (`completed_at` nulo) + evento na timeline
- [x] Ajustar o enrollment `b6e644b6`, que estava em `current_step = 10` numa cadência de 7 passos (ver nota 2)

## Risks

- Enrollment `paused` não é alcançado pelo auto-perda (cron olha `active`/`completed`) nem pelo alerta de limbo. Se acumular, vira story própria — hoje são ~2/mês.

## Dev Agent Record

### Notas

**1. Por que pausar e não deixar ativa.** `fetch-pending-activities.ts` esconde passos de WhatsApp de lead com `whatsapp_invalid_at`. Enrollment `active` num passo de WhatsApp sai da fila em silêncio — o mesmo limbo, com outra roupa. `paused` é o estado visível, e o aviso diz o que fazer.

**2. Ajuste do enrollment `b6e644b6`** (lead `a6e29be5` "AbaIncêndio", João Fogaça), 14/set, a pedido do Vini. Estava em `current_step = 10` numa cadência de 7 passos — sobra de uma edição antiga da Recovery. Passos 1–5 executados, passo 6 (ligação) nunca feito, passo 7 (WhatsApp) com a tentativa falha que gerou o "Não é WhatsApp".

- Pedido original era passo 7; trocado para **6** porque o 7 é WhatsApp e o lead está `whatsapp_invalid_at` — no 7 a atividade não apareceria na fila.
- Resultado: `current_step = 6`, `status = 'active'`, vencimento **15/set 09:00 BRT**, evento `cadence_resumed` na timeline (`metadata.reason = 'step_out_of_range_fix'`).
- ⭐ **Lição:** mudar `current_step`/`status` dispara o trigger `calculate_next_step_due`, que aplica o `delay_days` do passo — os 6 dias do passo 6 jogaram o vencimento para 21/09. Para puxar para o dia seguinte, um `UPDATE` só em `next_step_due` resolve: o trigger é `OF current_step, status` e não recalcula.

### File List
- `src/features/activities/actions/report-whatsapp-invalid.ts`
- `src/features/activities/actions/report-whatsapp-invalid.test.ts` (novo)
- `docs/stories/whatsapp-invalid-keeps-enrollment.story.md` (novo)

## QA Results
_(pendente)_

# Story: Atividade ligada à inscrição — lead reinscrito refaz a cadência

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-06 | Vini + Claude | Story criada como continuação de `executed-step-ignores-system-events` (PR #458). |

## Origem

- Quando um lead é inscrito **de novo** na mesma cadência, as atividades da inscrição anterior contam como "passo já feito" na nova: a fila esconde o passo, ele não aparece como atrasado e a cadência para. Em 06/out eram 12 casos (10 do Guilherme — 8 da Prospecção Fria reinscritos em 30/09 com ligações de julho —, 1 do Giovanni, 1 de lead sem dono). Os do Guilherme foram destravados à mão (`docs/sessions/2026-10/2026-10-06-destravar-cadencias-guilherme.sql`).
- Não dá para resolver só filtrando por `enrolled_at`: o índice único `uq_interactions_sent_step_lead_real` é `(cadence_id, step_id, lead_id)` e não conhece a inscrição. O passo voltaria a aparecer, mas a execução daria erro 23505 (SDR, motor de e-mail, `confirm_external_step` da V4 Call e `advance_enrollment_after_step`).
- Mesma família: a parada automática por resposta/bounce do motor (`execute-cadence.ts`, ~linha 430) olha a cadência inteira — lead reinscrito que já tinha respondido antes é encerrado na hora.

## Story

**As a** SDR / gestor,
**I want** que cada atividade de cadência pertença a uma inscrição,
**so that** reinscrever um lead na mesma cadência faça ele percorrer os passos de novo, sem travar.

## Acceptance Criteria

1. `interactions.enrollment_id uuid NULL REFERENCES cadence_enrollments(id) ON DELETE SET NULL`, com índice.
2. Toda gravação de atividade de cadência preenche `enrollment_id` (app, edge functions e funções SQL — ver levantamento abaixo).
3. Backfill: interactions com `step_id` recebem a inscrição do mesmo `(cadence_id, lead_id)` cujo período contém o `created_at` (`enrolled_at` ≤ `created_at` < próxima inscrição). Ambíguos ficam NULL e são contados no relatório da migration.
4. Índice único passa a ser por inscrição: `(enrollment_id, step_id) WHERE type='sent' AND channel <> 'system' AND enrollment_id IS NOT NULL`; o legado (sem `enrollment_id`) mantém a regra atual até sumir.
5. "Passo já feito" (as 4 funções SQL, `executeActivity`, motor de e-mail) passa a olhar `enrollment_id` da inscrição atual.
6. Parada por resposta/bounce do motor considera só eventos desta inscrição.
7. Teste: lead reinscrito na mesma cadência vê o passo 1 na fila, executa sem erro, e a cadência anda.
8. `pnpm gen:types` no mesmo PR (coluna nova).

## Scope

**IN:** migration (coluna, backfill, índices, funções), todos os pontos de gravação com `step_id`, motor (`execute-cadence.ts`), idempotência (`execute-activity.ts`), `persist-call.ts`, `confirm_external_step`, `advance_enrollment_after_step`, telas de métrica por passo (`fetch-cadence-performance.ts`, `step-analytics.service.ts`, `fetch-step-ab-metrics.ts`) se passarem a contar por inscrição.

**OUT:** mudar como as métricas de cadência são exibidas; reescrever o histórico do lead.

## Levantamento inicial (06/out)

Arquivos que gravam/leem interactions com `step_id`: `execute-activity.ts`, `skip-step.ts`, `complete-dialer-call.ts`, `report-whatsapp-invalid.ts`, `execute-cadence.ts`, `check-email-replies.ts`, `save-timeline-steps.ts`, `save-auto-email-steps.ts`, `persist-call.ts`, `api/webhooks/whatsapp/route.ts`, `api/track/{open,click}`, `meeting-reminders.service.ts`, `log-lead-event.ts`, `add-lead-note.ts`, `supabase/functions/_shared/whatsapp-reply.ts`; funções SQL `advance_enrollment_after_step`, `confirm_external_step`, `claim_due_steps`.

## Riscos

- Muitos pontos de gravação: esquecer um deixa `enrollment_id` NULL e o passo cai na regra legada (não quebra, mas não resolve). Mitigar com teste/consulta que acusa interaction de cadência sem `enrollment_id` depois do deploy.
- Backfill ambíguo em leads com várias inscrições sobrepostas.
- Índice novo + coluna em tabela de ~114 mil linhas: rápido, mas trava gravação por instantes.

## Complexidade
M–L (muitos pontos de gravação, migration com backfill).

## Tasks
- [ ] Validar story (@po)
- [ ] Migration: coluna + backfill + índices
- [ ] Preencher `enrollment_id` em todos os pontos de gravação
- [ ] "Passo feito" e parada por resposta por inscrição
- [ ] Testes + `pnpm gen:types`
- [ ] Destravar os 2 reinscritos restantes (Giovanni, sem dono)

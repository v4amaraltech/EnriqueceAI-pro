# Story: Card do Kommo não se perde quando a rede falha no feedback "Realizada"

**Status:** InReview
**Tipo:** Bug fix / resiliência
**Origem:** Vini (29/10/2026) — incidente 26–27/10/2026 (4 leads sem card)
**Relacionadas:** `rescheduled-meeting-crm-and-feedback` (regra do card), PR #506 (worker `backfill-kommo-orphans` com `leadIds`)

## Problema
Lead COM closer só ganha card no Kommo quando o closer responde "Realizada" (`/api/feedback` → `after(() => pushConfirmedMeetingToCrm(...))`). Em 26–27/10 o host do Coolify ficou sem DNS (`getaddrinfo EAI_AGAIN` no domínio do Kommo) exatamente quando 4 closers responderam. O que acontecia:

1. `pushContact` falhava por rede, o erro era engolido (`console.error`) e `pushLeadToCrm` devolvia `skippedReason: 'no_contact_id'` em silêncio.
2. Nada tentava de novo: nem o `after()` do feedback, nem o cron.
3. A única rede de segurança (`pushExpiredFeedbackLeadsToCrm`, cron `feedback-reminders`) só cobre link de feedback VENCIDO sem resposta — o caso aqui é link RESPONDIDO com push perdido.

Os 4 leads foram recriados à mão em 29/10 pelo worker. Esta story tira a dependência do operador.

## Critérios de aceite
- [x] **Retry com backoff só em erro de rede.** `pushLeadToCrm` aceita uma política de repetição; em erro de transporte (`fetch failed`/`EAI_AGAIN`/`ECONNRESET`/`ENOTFOUND`/timeouts `AbortSignal.timeout`/`withTimeout`) repete até 3 vezes com esperas de 2s, 8s e 30s. Erro de resposta do CRM (`Kommo API error (4xx/5xx)`) NÃO repete.
- [x] **Sem card duplicado.** Cada tentativa recomeça do dedup por interação `crm_deal_created` (e reaproveita o contato `crm_synced`), então repetir nunca cria um segundo card.
- [x] **`pushContact` por rede não é mais engolido.** Quando falha por rede e não há contato sincronizado para reaproveitar, o erro sobe para o retry. Falha 4xx do `pushContact` mantém o fluxo antigo (loga e devolve `no_contact_id`).
- [x] **Motivo final no log.** Esgotadas as tentativas, `console.error` com `leadId`, `orgId`, nº de tentativas e o código do erro (`[EAI_AGAIN]`); o erro é relançado ao chamador.
- [x] **Quem repete:** `pushConfirmedMeetingToCrm` (feedback do closer, cron, worker — todos em segundo plano) repete por padrão. O clique de "Ganho" do SDR (`markLeadAsWon` → `pushLeadToCrm`) continua com UMA tentativa, porque é síncrono e não pode esperar 40s; o que falhar ali é coberto pela reconciliação.
- [x] **Reconciliação diária** no cron `feedback-reminders` (`reconcileConfirmedMeetingsToCrm`): para cada org com CRM `connected`, leads `status = 'won'`, `deleted_at is null`, `won_at` nos últimos 14 dias, que (a) não têm closer ou (b) têm `closer_feedback_requests.result = 'meeting_done'`, e que NÃO têm `crm_deal_created` → `pushConfirmedMeetingToCrm` em cada um. Consultas em lotes de 100 ids no `.in()`.
- [x] **Log de quantos foram recuperados** (`console.warn` com ids) e contadores na resposta do cron (`crmReconciled`, `crmReconcileCandidates`, `crmReconcileFailed`, `crmReconcileAborted`). Erro inesperado na reconciliação não derruba o cron.
- [x] **Rede fora durante a reconciliação:** no primeiro lead que esgota o retry por rede a varredura para (`abortedByNetwork`), em vez de gastar 40s por lead; amanhã roda de novo.
- [x] **Elegibilidade única.** A regra do card (já sincronizado / closer sem "Realizada" / sem closer) saiu do worker `backfill-kommo-orphans` para `selectCrmEligibleWonLeads` em `crm-reconcile.service.ts`; worker e cron usam a mesma função. O worker mantém o mesmo contrato de resposta (`skipped` com `reason`).
- [x] Nunca move deal para a etapa 142 "Venda ganha" (`markDealWonInCrm` não é tocado).
- [x] Testes Vitest: retry só em rede / sem retry em 4xx / `pushContact` por rede relançado / log final com `leadId` / `pushConfirmedMeetingToCrm` repete por padrão; reconciliação pula lead com closer sem `meeting_done` e lead já sincronizado, lotes de 100, aborta em rede, erro de API segue; cron chama a reconciliação e devolve contadores.

## Decisões (opções consideradas)
1. **Onde repetir** — (1) dentro de `pushLeadToCrm` com política por chamador ✅; (2) só em `pushConfirmedMeetingToCrm` envolvendo a chamada inteira; (3) dentro de `crmFetch` para todos os adaptadores. Escolhida a 1: o dedup fica dentro de cada tentativa, o clique síncrono do SDR não espera, e `crmFetch` repetindo cegamente duplicaria POSTs que já chegaram ao Kommo.
2. **Onde reconciliar** — (1) função irmã no cron `feedback-reminders` ✅; (2) cron novo; (3) dentro do worker. Escolhida a 1: já roda todo dia com service role e já tem a rede de segurança dos vencidos; um cron novo exigiria migration de `pg_cron`.
3. **Rede fora no meio da reconciliação** — (1) parar na primeira falha de rede ✅; (2) seguir e esgotar 40s por lead; (3) sem retry na reconciliação. Escolhida a 1.

## Fora de escopo
- Retry no clique de "Ganho" (síncrono) — coberto pela reconciliação.
- Retry para `markDealWonInCrm` / sync de contatos (`crm-sync.service`).
- Lead com closer cujo feedback venceu sem resposta (continua em `pushExpiredFeedbackLeadsToCrm`).
- Cron próprio / horário dedicado para a reconciliação.

## Como testar
```bash
pnpm exec vitest run src/features/leads/services/crm-network-retry.test.ts src/features/leads/services/crm-push-retry.test.ts src/features/leads/services/crm-reconcile.service.test.ts src/features/leads/services/crm-push-confirmed.test.ts src/app/api/workers/backfill-kommo-orphans/route.test.ts src/app/api/cron/feedback-reminders/route.test.ts
```
Em produção: `POST /api/cron/feedback-reminders` (Bearer `CRON_SECRET`) devolve `crmReconciled`/`crmReconcileCandidates`; com a rede boa e nenhum card perdido, `crmReconcileCandidates = 0`.

## File List
- `src/features/leads/services/crm-network-retry.ts` (novo) — `isNetworkError`, `withNetworkRetry`, políticas
- `src/features/leads/services/crm-network-retry.test.ts` (novo)
- `src/features/leads/services/crm-push.service.ts` — `pushLeadToCrm(…, retry)`, `pushLeadToCrmWithDefaults(…, retry)`, `pushConfirmedMeetingToCrm(…, retry = padrão)`, `pushContact` relança erro de rede
- `src/features/leads/services/crm-push-retry.test.ts` (novo)
- `src/features/leads/services/crm-reconcile.service.ts` (novo) — `selectCrmEligibleWonLeads`, `reconcileConfirmedMeetingsToCrm`
- `src/features/leads/services/crm-reconcile.service.test.ts` (novo)
- `src/app/api/workers/backfill-kommo-orphans/route.ts` — usa `selectCrmEligibleWonLeads`
- `src/app/api/workers/backfill-kommo-orphans/route.test.ts` — mock do `crm_deal_created` em lote
- `src/app/api/cron/feedback-reminders/route.ts` — chama `reconcileConfirmedMeetingsToCrm` após os lembretes
- `src/app/api/cron/feedback-reminders/route.test.ts` (novo)
- `docs/stories/kommo-push-retry-reconcile.story.md` (esta)

## Change Log
- 2026-10-29: implementação + testes (@dev). Sem commit — aguardando o Vini.

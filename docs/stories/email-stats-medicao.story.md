# Story: Estatísticas de e-mail medem só e-mail de prospecção, 1 resposta e 1 bounce por lead

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-11-18 | @dev | Implementado. Conferido no banco (01/out–17/nov, V4 Amaral): 1.439 e-mails, 732 leads, 87 com bounce (11,9%), 305 abriram (41,7%), 10 responderam (1,4%). Antes a tela somava 2.344 enviados e 312 respostas. Tela não conferida logada. |
| 2026-11-18 | Vini + Claude | Story criada a partir da auditoria do motor de e-mail (18/nov). |

## Origem

Auditoria de out–nov/2026 (org V4 Amaral) na tela **Estatísticas › E-mails** (`fetchEmailAnalyticsData`):

- Dos 2.344 "enviados", só 1.439 eram e-mails de cadência que de fato saíram pelo Gmail. O resto: 345 marcados pelo botão "Enviado manualmente" (`metadata.manual_send`, sem passar pelo Gmail), 286 lembretes de reunião (`metadata.meeting_reminder`, sem cadência), 168 da Ana IA (`metadata.source = 'ana_ia_email'`) e 102 pedidos de feedback ao closer (`source = 'closer_feedback'`).
- As respostas eram contadas por linha: 312 linhas de `replied` para 26 leads (re-gravações antigas do fio).
- O bounce era contado por linha e dividido por e-mails enviados de todos os tipos.

## Story

**As a** gestor,
**I want** que a tela de e-mails mostre só os e-mails de prospecção que saíram de verdade, com resposta e bounce contados uma vez por lead,
**so that** eu possa confiar no número para decidir o que fazer com o motor de e-mail.

## Acceptance Criteria

1. **Enviados** conta só `sent` de e-mail com `cadence_id`, `external_id` (saiu pelo Gmail), sem `metadata.manual_send`, sem `metadata.meeting_reminder` e com `metadata.source` fora de `ana_ia_email`, `closer_feedback`, `bdr_email_agent`.
2. Abertura, clique, resposta e bounce só contam eventos com `cadence_id`, fora dessas mesmas origens e **de leads que receberam e-mail de cadência no período** (bounce/resposta não carregam a origem do envio; sem isso o bounce de e-mail da Ana vazava).
3. Abertura, clique, resposta e bounce contam **leads distintos** (um lead com 12 linhas de resposta conta 1).
4. Nova taxa de bounce = leads com bounce ÷ leads que receberam e-mail, mostrada no card de enviados.
5. O funil passa a ser por lead: leads que receberam → entregues (sem bounce) → abriram → clicaram → responderam.
6. Tendência diária: enviados por dia (e-mails); aberturas e respostas pela **primeira** ocorrência do lead no período. Tendência de bounce: primeira ocorrência por lead.
7. Filtros de período, SDR e cadência continuam funcionando.

## Scope

**IN:** `src/features/statistics/services/email-analytics.service.ts` (+ teste), `src/features/statistics/types/email-analytics.types.ts`, `src/features/statistics/components/EmailAnalyticsView.tsx`.

**OUT:** apagar as linhas duplicadas de `replied` no banco; métricas de e-mail da lista de cadências e dos relatórios; painel de saúde do motor (caixas, falhas, Gmail desconectado) — story própria.

## Tasks
- [x] Filtro de origem dos e-mails (função pura + teste)
- [x] Contagem por lead de abertura, clique, resposta e bounce + taxa de bounce
- [x] Funil e tendências por lead
- [x] Tela: card de enviados com taxa de bounce; textos "leads"
- [x] `pnpm typecheck`, `pnpm lint`, testes da feature
- [x] Conferir números contra o banco (out–nov) — conferido pela mesma regra em SQL; tela logada não aberta

## File List
- `docs/stories/email-stats-medicao.story.md`
- `src/features/statistics/services/email-scope.ts` (novo)
- `src/features/statistics/services/email-analytics.service.ts`
- `src/features/statistics/services/email-analytics.service.test.ts` (novo)
- `src/features/statistics/types/email-analytics.types.ts`
- `src/features/statistics/components/EmailAnalyticsView.tsx`

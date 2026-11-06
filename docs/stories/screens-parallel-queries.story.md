# Story: Telas sem consultas em fila — Atividades, Leads e histórico do lead

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial: APROVADO, sem problema confirmado. Opcionais aplicados: `.catch` antecipado nas consultas independentes de Leads, teste travando as colunas da fila, teste de meta com as duas respostas explícitas. |
| 2026-10-04 | @dev (Dex) | Implementado + testado; ganho medido contra prod no histórico do lead. |
| 2026-10-04 | Vini + Claude | Story criada a partir da frente "consultas em fila nas telas" (auditoria de 04/out). |

## Origem

Medição de 04/10: o banco responde rápido (média 160 ms por consulta em dia útil), mas várias telas fazem consultas **uma depois da outra** — cada ida ao banco soma.

- **Atividades** — `fetchDailyProgress`: até **9 consultas em série**; 4–5 delas calculavam "pendentes", número que a página **descarta** (usa o tamanho da fila). A fila (`fetchPendingActivities`) trazia **todas as colunas** do lead (`leads!inner(*)`) em até ~1.500 linhas.
- **Leads** — 7 consultas independentes (filtros, contagens, membros) só começavam **depois** da lista de leads voltar.
- **Histórico do lead** — `fetchLeadTimeline`: **6 consultas em série**.

## Story

**As a** SDR/gestor,
**I want** que Atividades, Leads e o histórico do lead abram mais rápido,
**so that** eu perca menos tempo esperando a tela.

## Acceptance Criteria

1. `fetchDailyProgress` roda as partes independentes em paralelo; resultado idêntico (meta: a do usuário, senão a da org, senão 20).
2. `fetchDailyProgress(sdr, { includePending: false })` não faz a conta de pendentes; a página de Atividades usa essa opção. O filtro por SDR do gestor (cliente) continua com pendentes.
3. A fila de atividades busca só as colunas do lead que usa (`ActivityLead` + `whatsapp_invalid_at`).
4. A página de Leads dispara filtros/contagens/membros junto com a lista.
5. `fetchLeadTimeline` faz duas rodadas paralelas (interações; depois cadências, passos, nomes e ligações), com o mesmo resultado.

## Resultado

- Histórico do lead (contra prod, lead com 39 interações): **~150 ms → ~75 ms** (em fila × paralelo, sem a 1ª execução fria).
- Fila de atividades: resposta **176 KB → 126 KB** (−28%) com 85 itens; cresce com a fila.
- Atividades: profundidade de `fetchDailyProgress` na página de **9 idas em série → 1 rodada** (pendentes pulados, resto em paralelo).
- Leads: os filtros deixam de esperar a lista (uma rodada a menos).

## Scope

**IN:** `fetch-daily-progress.ts`, `atividades/page.tsx`, `fetch-pending-activities.ts`, `leads/page.tsx`, `fetch-interactions.ts`, testes.

**OUT:** `select('*')` da lista de Leads (a tabela usa muitos campos do `LeadRow`; risco > ganho); transcrição sob demanda no histórico (muda a UI); demais telas.

## Tasks

- [x] `fetchDailyProgress` em paralelo + `includePending`
- [x] Fila de atividades com colunas explícitas (validado contra a API de prod)
- [x] Leads: consultas independentes junto com a lista
- [x] Histórico do lead em duas rodadas + teste novo
- [x] typecheck / lint / test:run / build
- [x] Revisão (APROVADO)
- [x] PR

## File List

- `src/features/activities/actions/fetch-daily-progress.ts` (modificado) · `fetch-daily-progress.test.ts` (modificado)
- `src/app/(app)/atividades/page.tsx` (modificado)
- `src/features/activities/actions/fetch-pending-activities.ts` (modificado) · `fetch-pending-activities.test.ts` (modificado)
- `src/app/(app)/leads/page.tsx` (modificado)
- `src/features/cadences/actions/fetch-interactions.ts` (modificado) · `fetch-interactions.test.ts` (novo)
- `docs/stories/screens-parallel-queries.story.md` (novo)

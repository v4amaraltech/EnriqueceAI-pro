# Story: Estatísticas leem todas as linhas do período (fim do `.limit(10000)`)

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @devops (Gage) | Ready for Review → **Done**. PR #385 mergeado 11/set 09:18 UTC (squash `54274a25`, com autorização do Vini), ✅ **no ar** 09:22 UTC (`/api/version` = `54274a2`). CI verde (4m44s). Todas as leituras das estatísticas e do CSV de ligações paginadas em prod. Tela de Conversão conferida no Chrome do Vini (01–11/set) = banco. |
| 2026-09-10 | @dev (Dex) | Implementado. typecheck ✅ lint ✅ 1.977 testes ✅ (+6 novos) build ✅. Os 6 testes novos falham contra o código antigo (conferido). Nada commitado (regra git manual). |
| 2026-09-10 | Vini + Claude | Story criada a partir da descoberta em `call-effectiveness-view` (`content-range: 0-9999/15033`). |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

As telas de estatística faziam `.limit(10000)` (ou `5000`) e o PostgREST devolve só essa quantidade, **sem avisar**. Sem `ORDER BY`, o pedaço é arbitrário. A tela de Ligações já foi corrigida com `lib/supabase/fetch-all-rows.ts` (story `call-effectiveness-view`).

**Teto do servidor medido:** `max-rows = 20.000` — uma consulta **sem** `.limit()` também corta em 20 mil.

### Medição em prod (V4 Amaral `c2727473…`, 10/set/2026, só leitura)

| Consulta | 30 dias | 90 dias | Cortava hoje? |
|---|---:|---:|---|
| Atividades — interações | 13.127 | 35.172 | **sim** (30d) |
| Atividades — leads ganhos / perdidos / criados | 79 / 1.064 / 1.114 | 215 / 2.395 / 3.647 | não |
| Atividades — todos os leads (sem período) | 6.307 | 6.307 | não (cresce sempre) |
| Cadências — enrollments (sem período) | 7.319 | 7.319 | não (cresce sempre) |
| Cadências — respostas/reuniões | 0 | 2 | não |
| Cadências — engajamento | 13.322 | 26.525 | **sim** (30d) |
| Performance — interações | 12.320 | 31.986 | **sim** (30d) |
| Performance — leads do período | 1.114 | 3.647 | não |
| Motivos de perda — enrollments / leads | 2.116 / 1.064 | 5.161 / 2.395 | não |
| E-mail — interações | 1.501 | 3.724 | não |
| Passos — interações (maior cadência) | 2.324 | 2.546 | não |
| Feedback — pedidos | 83 | 232 | não |
| Painel de Ligações — ligações | 12.170 | 29.056 | **sim** (30d) |
| Conversão — interações (não estava na lista) | 24.205 | 58.218 | **sim** (30d) |
| Conversão — leads por won/lost/meeting_held (`limit 5000`) | 79 / 1.064 / 80 | 215 / 2.395 / 216 | não |
| Exportação CSV de ligações (`limit 5000`) | mês: 4.455 (dia 10) · todas: 39.796 | — | **sim** ("Todas"; "Mês" a partir de ~dia 11) |

O filtro de datas livre (`dateRange`) não tem limite, então qualquer consulta com período corta num intervalo grande o bastante.

**Bug extra achado (Conversão):** a busca dos "leads tocados no período" mandava ~2.400 ids num `.in()` só → **HTTP 414** → a lista voltava vazia em silêncio. Efeito medido (30 dias): Total 1.920 → **3.549**, Contactados 1.283 → **3.471**, Qualificados 39 → **108**, SAL 79 → 79.

## Scope

**IN:** trocar todas as leituras listadas acima por paginação (`fetchAllRows`) com ordem determinística terminando em coluna única; lotes de 200 ids nos leads tocados da Conversão; CSV com só as colunas usadas (1,3 KB → 0,2 KB por linha).

**OUT:** agregação no banco (RPC) — ver "Avaliação"; aviso de truncamento na tela (só log, o teto é 200 mil); `membership` da Conversão (lotes de 300 leads, `limit 20000`, não corta).

## Acceptance Criteria
- [x] AC1 — Nenhuma consulta das telas de estatística e da exportação CSV usa `.limit(10000)`/`.limit(5000)`.
- [x] AC2 — Toda leitura paginada ordena por (data, `id`) ou só `id`.
- [x] AC3 — Com um servidor que corta em 1.000 linhas, Atividades, Cadências, Performance, Painel de Ligações, Conversão e CSV contam as 12.000 linhas do teste.
- [x] AC4 — Conversão inclui leads criados antes do período e tocados nele, mesmo com milhares de ids.
- [x] AC5 — Erro do banco vira erro da tela (antes virava "zero").

## Avaliação: paginar × agregar no banco

Paginar custa pouco hoje (medido daqui: 35 mil linhas em 1,1 s, 58 mil em 1,3 s; pior página 170 ms) e mantém as regras em TypeScript. O problema é o crescimento: ~24 mil interações/mês → ~7 MB de JSON por abertura da Conversão em 90 dias, e um período livre de ~8 meses passa do teto de segurança (200 mil) — aí o número volta a ser parcial (só com log).

Candidatas a RPC com `GROUP BY` (devolvem centenas de linhas em vez de dezenas de milhares):
1. **Conversão** — só precisa de "quais leads tiveram `sent`/`meeting_scheduled`". A mais pesada.
2. **Atividades** — contagens por canal/tipo/dia/SDR.
3. **Performance** e **Cadências (engajamento)** — contagens por SDR/dia e leads distintos por tipo.

Ficam paginadas: Ligações e Painel de Ligações (regras de conexão em `features/calls/connection.ts`), E-mail, Passos, Feedback, Motivos de perda.

## Dev Agent Record
### File List
- `docs/stories/statistics-fetch-all-rows.story.md` (novo)
- `src/features/statistics/services/read-all-rows.ts` (novo) — `fetchAllRows` + log se truncar
- `src/features/statistics/services/activity-analytics.service.ts` (5 consultas)
- `src/features/statistics/services/cadence-analytics.service.ts` (3)
- `src/features/statistics/services/performance-analytics.service.ts` (2)
- `src/features/statistics/services/loss-reason-analytics.service.ts` (2)
- `src/features/statistics/services/email-analytics.service.ts` (1, dois caminhos)
- `src/features/statistics/services/step-analytics.service.ts` (1, dois caminhos)
- `src/features/statistics/services/feedback-analytics.service.ts` (1)
- `src/features/statistics/services/call-dashboard.service.ts` (1)
- `src/features/statistics/services/conversion-analytics.service.ts` (6 + lotes nos leads tocados)
- `src/features/calls/actions/export-calls-csv.ts` — paginado, colunas enxutas, erro claro acima de 200 mil
- `tests/mocks/postgrest-table.ts` (novo) — PostgREST de mentira: teto por resposta, 414 em `.in()` grande, filtros e ordem
- `src/features/statistics/services/fetch-all-rows.statistics.test.ts` (novo, 5 testes)
- `src/features/calls/actions/export-calls-csv.test.ts` (+1 teste, mock com `range`)
- `call-dashboard`, `feedback-analytics`, `loss-reason-analytics`, `__tests__/step-analytics` `.test.ts` — mocks ganharam `range`/`order`

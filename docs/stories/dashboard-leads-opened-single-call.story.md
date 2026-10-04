# Story: Dashboard — "Leads Abertos" com uma chamada em vez de três

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR): no mês corrente (tela padrão) a página corta o fim em HOJE e o painel do SDR pedia o mês inteiro → janelas diferentes, 2 chamadas. `clampEndToToday` normaliza o fim (sem abertura no futuro, mesmo resultado) → 1 chamada. Aviso quando a resposta chegar ao limite de 20 mil linhas do PostgREST; comentário desatualizado do sdr-pace corrigido. |
| 2026-10-04 | @dev (Dex) | Implementado + testado; números conferidos contra prod (0 diferenças). |
| 2026-10-04 | Vini + Claude | Story criada a partir da frente "Dashboard lento" (auditoria de 04/out). |

## Origem

`count_leads_opened_by_sdr` era a consulta mais lenta do Dashboard: em 02/10 (sexta), 756 chamadas, **624 ms em média**, p95 1,7 s (picos de 3,6–5,6 s no fim de semana).

Diagnóstico:
- `count_leads_opened_by_sdr` e `count_leads_opened_by_sdr_daily` filtram o **mesmo** `leads_opened_events(org)` — que recalcula as aberturas da **história inteira** da org (~95 mil toques, ~47 mil buffers, ~230 ms com cache quente). A 1ª só agrupa por SDR; a 2ª devolve uma linha por abertura.
- Por abertura do Dashboard eram **3 recálculos**: o card "Leads Abertos" chamava as duas **em série** (total → gráfico) e o painel "SDR selecionado" chamava a contagem de novo (756 = 2 × 374 chamadas/dia).
- Reescrever a função no banco para olhar só leads com toque no período ficou **pior** (1,1 s: em set/2026, 2,3 mil dos 7,5 mil leads tiveram toque; buscar lead a lead custa mais que varrer). Mais `work_mem` tira a ida ao disco mas não muda o tempo. → o ganho está em **não repetir** o cálculo.

## Story

**As a** gestor/SDR,
**I want** que o Dashboard carregue o card "Leads Abertos" mais rápido,
**so that** eu acompanhe o ritmo sem esperar.

## Acceptance Criteria

1. O card "Leads Abertos" (total por SDR + gráfico diário) usa **uma** chamada a `count_leads_opened_by_sdr_daily`; o total por SDR sai das linhas.
2. O painel "SDR selecionado" usa a mesma fonte; na mesma requisição e sem filtro de cadência **divide a chamada** com o card — inclusive no mês corrente (fim de janela depois de hoje é normalizado para hoje 23:59 BRT).
3. Números idênticos aos de antes, SDR a SDR.
4. Erro: o card continua mostrando 0 / gráfico vazio (como antes); o painel do SDR continua lançando.

## Resultado (contra prod)

| Período | Antes (3 chamadas) | Depois (1 chamada) | Diferenças |
|---|---|---|---|
| set/2026 (6 SDRs, 1.531 aberturas) | 843 ms | 259 ms | 0 |
| out/2026 | 744 ms | 275 ms | 0 |

## Scope

**IN:** `services/leads-opened.service.ts` (novo), `ranking-metrics.service.ts` (`fetchLeadsOpenedRanking`, `buildLeadsOpenedDaily`), `sdr-pace.service.ts` (`countLeadsOpened`), testes.

**OUT:** mudar `leads_opened_events`/RPCs no banco (testado, sem ganho); `count_leads_opened_by_sdr` continua existindo (Sales Hub/outros); demais cards do Dashboard.

## Riscos

- O total por SDR agora depende de a `_daily` não ser cortada pelo limite de linhas do PostgREST (20.000 em prod; antes só o gráfico dependia). Maior mês de qualquer org: 1.635 (jul/2026) — margem de ~12×. Há `console.warn` ao chegar no limite.
- Com filtro de cadência no Dashboard, o card usa as cadências e o painel do SDR não → 2 chamadas nesse caso (como antes era 3).

## Tasks

- [x] `fetchLeadsOpenedRows` + `countOpenedByPerformer` (memo por requisição)
- [x] Card "Leads Abertos" e painel do SDR usando a fonte única
- [x] Testes (`leads-opened.service.test.ts`; ranking e sdr-pace atualizados)
- [x] Conferência contra prod (números e tempo)
- [x] typecheck / lint / test:run / build
- [x] Revisão (ajustes aplicados)
- [x] PR

## File List

- `src/features/dashboard/services/leads-opened.service.ts` (novo)
- `src/features/dashboard/services/leads-opened.service.test.ts` (novo)
- `src/features/dashboard/services/ranking-metrics.service.ts` (modificado)
- `src/features/dashboard/services/ranking-metrics.service.test.ts` (modificado)
- `src/features/dashboard/services/sdr-pace.service.ts` (modificado)
- `src/features/dashboard/services/sdr-pace.service.test.ts` (modificado)
- `docs/stories/dashboard-leads-opened-single-call.story.md` (novo)

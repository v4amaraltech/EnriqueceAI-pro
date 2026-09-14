# Story: Card "Ligações Realizadas" no lugar de "Atividades Realizadas"

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-14 | Vini + Claude | Story criada. Pedido do Vini: "quero mudar esse componente: ao invés de Atividades Realizadas, coloca Ligações Realizadas" (print do card). Decisões: meta do mês = **soma das metas por SDR** (`goals_per_user.calls_target`); o card de Atividades sai do Dashboard, mas a **meta de atividades continua** no "Editar metas". |
| 2026-09-14 | @dev (Dex) | Draft → InProgress. |
| 2026-09-14 | @dev (Dex) | InProgress → **Done** (pedido do Vini: "marca a story como concluída"). **PR #411 mergeado** 09:44 UTC (squash `3b072a34`), **no ar** 09:47 UTC (`/api/version` = `3b072a3`); CI verde de primeira. Coluna "ideal dia" retirada antes do commit (ideal acumulado × média diária não se comparam). |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint", "build"]

## Origem

O card "Atividades Realizadas" mostrava atividades manuais por SDR (média diária) contra a meta de atividades da org (8.000). Depois da seção "SDR selecionado" (story `dashboard-sdr-pace-cards`), o time passou a acompanhar ligação como o número operacional do dia, e agora existe meta de ligações por SDR (`goals_per_user.calls_target`, 2.200 em setembro).

## Story

**As a** gestor,
**I want** o card do ranking mostrar Ligações Realizadas por SDR em vez de Atividades,
**so that** o Dashboard acompanhe o mesmo número que o time cobra no dia a dia.

## Acceptance Criteria
1. No lugar do card "Atividades Realizadas" aparece **"Ligações Realizadas"**, com a mesma disposição: número grande, "% do previsto", "Meta mês", lista de SDRs com "média diária" e rodapé de média por vendedor.
2. O realizado é `calls` do SDR (`user_id`) com `type='outbound'` no período, mesma definição do card "Total de Ligações" do SDR selecionado e do Sales Hub. Inclui Callface; recebidas não entram.
3. A **meta do mês** é a soma de `goals_per_user.calls_target` dos SDRs do card (hoje 5 × 2.200 = 11.000). Sem meta individual, a meta do card é 0 e ele fica neutro.
4. O card mostra só a coluna "média diária" (como o de Atividades). **Sem coluna "ideal dia":** o ideal é acumulado do mês (ex.: 838 ligações) e ficaria lado a lado com um número por dia (117) — comparação sem sentido. O `idealToDate` por SDR continua calculado no serviço, pronto para uma coluna de cota diária no futuro.
5. O filtro de vendedor vale (SDR de fora não é consultado nem soma meta). O filtro de cadência **não** se aplica e o tooltip diz isso.
6. A contagem por SDR é exata (`count: 'exact', head: true`), sem baixar linhas — a org faz 10–11 mil ligações/mês.
7. A meta de atividades continua no "Editar metas" (Estatísticas › Atividades ainda usa).

## Scope
**IN:** `fetchCallsRanking` no `ranking-metrics.service`, troca do card no `DashboardView`, tipo `RankingData.callsDone`, testes.
**OUT:** meta de ligações no nível da org; o card de Atividades Atrasadas (fica como está); Estatísticas › Atividades; qualquer mudança nas metas já cadastradas.

## Complexity
**S**. 1 função de serviço, 1 card trocado, sem migration e sem mudança de banco.

## Risks
- `fetchActivitiesRanking` foi **removida** junto com o card (não tinha outro consumidor). A RPC `count_activities_by_performer` continua no banco, usada por outras telas.
- Os números do card mudam de escala (atividades ~4,7 mil → ligações ~4,5 mil no mês, mas contra meta de 11.000) — avisar o time.

## Tasks
- [x] `fetchCallsRanking` (contagem por SDR + soma das metas individuais)
- [x] `fetchIndividualTargets` aceita `calls_target`
- [x] `RankingData.activitiesDone` → `callsDone`; `fetchActivitiesRanking` removida
- [x] Card trocado no `DashboardView` (título, tooltip, ícone `PhoneCall`, labels)
- [x] Testes (4 novos em `ranking-metrics.service.test.ts`; fixtures do `DashboardView.test`)
- [x] `pnpm typecheck && pnpm lint && pnpm exec vitest run src/features/dashboard`
- [x] `pnpm test:run && pnpm build` (⭐ não rodar os dois ao mesmo tempo: 8 arquivos sem relação falharam por disputa de máquina e passaram sozinhos)
- [x] Conferência visual (claro/escuro, HTML estático) e paridade com o banco (4.546 em 01–14/set)
- [x] Deploy conferido (`/api/version` = `3b072a3`, 14/set 09:47 UTC)

## Dev Notes
- Setembro (01–14) no banco: Giovanni 1.174 · Guilherme 890 · Matheus 858 · João 851 · Ismael 773 = **4.546** contra meta **11.000**. Nesse período todas as ligações são `outbound`, então o filtro não esconde nada.
- "média diária" divide pelos dias úteis do período (`businessDays` do `DashboardView`, que **não** desconta feriados — comportamento antigo do card, mantido).

## File List
- `docs/stories/dashboard-calls-ranking-card.story.md`
- `src/features/dashboard/services/ranking-metrics.service.ts`
- `src/features/dashboard/services/ranking-metrics.service.test.ts`
- `src/features/dashboard/components/DashboardView.tsx`
- `src/features/dashboard/components/DashboardView.test.tsx`
- `src/features/dashboard/types/index.ts`

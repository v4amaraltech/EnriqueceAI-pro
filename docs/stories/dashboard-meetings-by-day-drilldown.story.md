# Story: Painel lateral com os leads ao clicar numa barra do gráfico "RM e RR por dia"

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-14 | Vini + Claude | Story criada. Pedido do Vini (print do gráfico): "menu lateral direito quando o usuário clicar em uma das barras do gráfico abrir e mostrar os leads que marcaram e realizaram reunião". Decisões: clicar em qualquer barra abre o **dia inteiro** em 2 seções (Marcadas / Realizadas), a série clicada primeiro; colunas Empresa (link) + SDR + horário. |
| 2026-09-14 | @dev (Dex) | Draft → InProgress. Implementado e testado localmente (261 testes do dashboard verdes, typecheck e lint OK). |
| 2026-09-14 | @dev (Dex) | InProgress → **InReview**. Commit `3627f963`, **PR #421** aberto (base `main` em `fb12f30c`). Suíte completa 2105 verdes, build OK, paridade com o banco conferida. |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint", "build"]

## Origem

O gráfico "Reuniões marcadas (RM) e realizadas (RR) por dia" (stories anteriores #348/#349) só mostra números. Para saber **quais** leads estão numa barra o gestor precisava ir na tela de Leads e filtrar na mão — e sem garantia de bater com o gráfico, porque a tela de Leads não usa a mesma regra dos cards.

## Story

**As a** gestor,
**I want** clicar numa barra do gráfico RM/RR e ver, num painel à direita, os leads que marcaram e realizaram reunião naquele dia,
**so that** eu consiga auditar o número do dia sem sair do Dashboard.

## Acceptance Criteria
1. Clicar em qualquer barra (RM ou RR) de um dia abre um painel lateral **direito** (`Sheet`) com título "Reuniões de DD/MM" e subtítulo "N marcadas · M realizadas".
2. O painel tem duas seções, **Marcadas (RM)** e **Realizadas (RR)**, com contagem no cabeçalho e a cor da série; a série clicada aparece primeiro.
3. Cada lead mostra **Empresa** (nome fantasia com link para `/leads/{id}`, razão social como subtexto — mesma regra do painel do lead; em prod ~90% dos leads com reunião só têm nome fantasia), **SDR** responsável e **horário** — RM: hora em que marcou (`meeting_scheduled_at`, BRT); RR: dia/mês e hora da reunião (`meeting_starts_at`, fallback `meeting_held_at`, BRT).
4. **A soma de cada lista é igual ao rótulo da barra**, com qualquer combinação de filtros da página (mês, cadência, vendedor). Para isso o painel reutiliza as mesmas funções que geram os cards: `fetchScheduledLeadsForRanking` (RM — sem filtro de cadência, como o card) e `fetchHeldLeadsForKpi` (RR), com o corte por dia no calendário BRT.
5. Seção sem leads mostra "Nenhuma reunião marcada/realizada neste dia"; erro da action aparece no painel.
6. O clique funciona também no gráfico do modal "Expandir".
7. Nomes dos SDRs vêm dos rankings já carregados na página (sem chamada extra ao `auth.admin`).

## Scope
**IN:** refactor de `fetchMeetingsScheduledRanking` (extrai o universo de leads), `HeldLead` com empresa, serviço `meetings-by-day-leads`, action `getMeetingsByDayLeads`, prop `onBarClick` no gráfico, componente `MeetingsByDayDrawer`, testes.
**OUT:** paginação (uma barra tem dezenas de leads no máximo); filtro/ação dentro do painel; drilldown genérico de `shared/components/drilldown` (a métrica `overall_meetings` de lá conta `interactions.type='meeting_scheduled'` e **não** bate com o gráfico).

## Complexity
**S/M**. Sem migration, sem mudança de banco, sem `gen:types`.

## Risks
- O refactor mexe na função que alimenta o card "Reuniões marcadas" — coberto por teste novo que confere total, por SDR e por dia com o mesmo mock.
- `fetchHeldLeadsForKpi` passa a selecionar 2 colunas a mais (`razao_social`, `nome_fantasia`) na consulta compartilhada por Realizadas/SAO — custo desprezível (≤ 10 mil linhas, já com `.limit`).

## Tasks
- [x] `fetchScheduledLeadsForRanking` + `brtDayOf` em `ranking-metrics.service.ts`; card passa a contar sobre esse universo
- [x] `HeldLead` com `razao_social`/`nome_fantasia`
- [x] `meetings-by-day-leads.service.ts` (corte por dia BRT, ordenação por horário)
- [x] Action `get-meetings-by-day-leads.ts` (zod `day` 1–31 + filtros do dashboard)
- [x] `MeetingsByDayChart`: prop `onBarClick`, `cursor: pointer`, ajuda atualizada; `RM_COLOR`/`RR_COLOR` exportados
- [x] `MeetingsByDayDrawer.tsx` (Sheet direita, 2 seções, skeleton, vazio, erro)
- [x] `DashboardView`: estado do dia clicado, `sdrNames` dos rankings
- [x] Testes: serviço (4), action (7), drawer (6), chart (+2), view (+1), ranking (+3)
- [x] `pnpm typecheck && pnpm lint && pnpm exec vitest run src/features/dashboard`
- [x] Conferência visual no preview (clique nas duas barras, modal expandido, tema escuro) — página temporária sob `/docs/`, apagada
- [x] `pnpm test:run` (2105 verdes) e `pnpm build` OK (um de cada vez)
- [x] Paridade com o banco (14/set, org V4): RR = 6 = barra; RM = 10 no banco × 9 no print do Vini — a 10ª foi marcada às 21:57 BRT, depois do print

## Dev Notes
- Regra de ouro: o painel **não** tem consulta própria. Só filtra em memória (dia BRT) o mesmo universo dos cards. Se algum dia o card mudar de regra, o painel acompanha sozinho.
- RR sem `assigned_to` (não aparece em ranking, mas conta no KPI sem filtro de vendedor) é listada com SDR "—".

## File List
- `src/features/dashboard/services/ranking-metrics.service.ts` (+ `.test.ts`)
- `src/features/dashboard/services/dashboard-metrics.service.ts`
- `src/features/dashboard/services/meetings-by-day-leads.service.ts` (+ `.test.ts`) — novo
- `src/features/dashboard/actions/get-meetings-by-day-leads.ts` (+ `.test.ts`) — novo
- `src/features/dashboard/components/MeetingsByDayChart.tsx` (+ `.test.tsx`)
- `src/features/dashboard/components/MeetingsByDayDrawer.tsx` (+ `.test.tsx`) — novo
- `src/features/dashboard/components/DashboardView.tsx` (+ `.test.tsx`)
- `src/features/dashboard/types/index.ts`
- `docs/stories/dashboard-meetings-by-day-drilldown.story.md`

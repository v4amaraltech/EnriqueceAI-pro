# Story: SAO (Oportunidades Aceitas por Vendas) no Dashboard — card, ranking e taxa

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-12 | Vini + Claude | Story criada a partir do plano aprovado. Decisões do Vini: número grande = quantidade de SAO (não taxa); meta própria de SAO no "Editar metas" (org + por SDR); escopo = card grande + ranking "SAO" + ranking "Taxa SAO" + corrigir o tooltip desatualizado de "Reuniões realizadas". |
| 2026-09-12 | @dev (Dex) | Implementado na `main` local (sem commit). typecheck ✅ lint ✅ testes ✅ (suíte completa 2.067; +19 novos) build ✅. Conferência visual em preview (claro/escuro) OK; handoff `docs/sessions/2026-09/2026-09-12-sao-no-dashboard.md`. **Pendente:** aplicar a migration em prod (aguarda pedido explícito do Vini) e depois `pnpm gen:types`; gestor preencher a meta de SAO de setembro. Sem commit/push/PR (aguarda pedido). |
| 2026-09-12 | @dev (Dex) | **Migration aplicada em prod** via MCP (pedido do Vini), versão `20260912095504` — arquivo renomeado para a mesma versão. Conferido: `sao_target integer NOT NULL DEFAULT 0` nas 2 tabelas. `pnpm gen:types` rodado (6 linhas). typecheck ✅. Sem commit/push/PR (aguarda pedido). |
| 2026-09-12 | @dev (Dex) | InProgress → **Ready for Review**. Commit + PR autorizados pelo Vini ("commita e abre o PR"): branch `feat/dashboard-sao-kpi-card` a partir de `origin/main` (`e3eb0ff4`), 2 commits (`a302e469` feat + `ce7f8242` types), **PR #404**. |
| 2026-09-12 | @dev (Dex) | Ready for Review → **Done** (pedido do Vini: "marca a story como concluída"). **PR #404 mergeado** 10:15 UTC (squash `1d46c38b`, pedido "mergeia o PR"). ⚠️ o `gh pr merge --auto --squash` mergeou com o job "Lint · Typecheck · Test · Build" ainda pendente (a proteção da branch não exige esse check) — CI local estava todo verde; CI da main acompanhado após o merge. Fica com o Vini: conferir o card logado e o gestor preencher a meta de SAO de setembro no "Editar metas". |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint", "build"]

## Origem

Desde 09/set/2026 (PR #369) o closer responde, em toda reunião **Realizada**, se a oportunidade é "Qualificada" ou "Não qualificada" — coluna `closer_feedback_requests.oportunidade_qualificada`. Isso é o **SAO** (Oportunidade Aceita por Vendas), o degrau seguinte do funil: Abertos → Marcadas → Realizadas → **SAO**. Até agora só aparecia em "Feedbacks dos Closers" e em `/statistics/feedback`. O gestor quer no Dashboard o mesmo card grande de "Reuniões realizadas" (número, meta, ritmo, gráfico acumulado × meta) para SAO.

Estado real em prod ao começar (V4 Amaral, 12/set, só leitura): set/2026 = 21 realizadas, 19 com feedback respondido, **4 avaliadas em SAO (4 qualificadas)**, a primeira em 09/set. O card nasce com histórico curto e a UI diz isso ("N avaliadas de M realizadas · K sem feedback do closer").

## Story

**As a** gestor,
**I want** ver no Dashboard quantas reuniões realizadas do mês o closer aceitou como oportunidade (SAO), contra uma meta e no ritmo do mês, por time e por SDR,
**so that** eu cobre qualidade de reunião e não só volume.

## Acceptance Criteria
1. Novo card grande "SAO" logo abaixo de "Reuniões realizadas", com número, meta do mês, "% do ritmo — esperado até hoje" e gráfico acumulado × meta (mesmo componente `OpportunityKpiCard`).
2. SAO = reunião realizada do mês (**mesmo universo, janela e filtros** do card de realizadas: `meeting_held_at` não nulo, `meetingsHeldWindowFilter`, cadência e vendedor) cujo feedback do closer **mais recente com a pergunta preenchida** tem `oportunidade_qualificada = true`. 1 SAO por lead.
3. Cada SAO é contada na **data da reunião** (`meetingHeldAnchor`), não na data da resposta do closer — SAO ⊆ realizadas em todo ponto do gráfico.
4. Reunião sem feedback, ou com feedback sem a pergunta (no-show, remarcada, histórico anterior a 09/set/2026), não entra — nem como aceita nem como recusada. O card mostra "N avaliadas de M realizadas · K sem feedback do closer".
5. Meta de SAO própria: `goals.sao_target` (org) e `goals_per_user.sao_target` (por SDR), editáveis no "Editar metas" (campo "Meta de SAO" e coluna "SAO" por vendedor).
6. Ranking "SAO" por SDR (atribuição por `leads.assigned_to`, só SDR ativo/invited, "ideal dia" pela meta individual com fallback compartilhado) e ranking "Taxa SAO" (SAO ÷ realizadas por SDR, meta derivada = meta de SAO ÷ meta de realizadas), no grid do funil, que passa a 6 cards em 3 colunas.
7. Reuniões realizadas são buscadas **uma vez** e compartilhadas entre realizadas e SAO (KPI e ranking).
8. Régua dupla preservada: contagem até hoje, pacing até ontem (`currentDayOfMonthBrt`).
9. Tooltips de "Reuniões realizadas" (card e ranking) deixam de falar em `status='won'` e descrevem a regra atual (data da reunião + carimbo de realizada).

## Scope
**IN:** migration aditiva (`sao_target` em `goals` e `goals_per_user`); util `latestSaoByLead`; serviço `fetchSaoByLead`; `fetchSaoKpi` + `fetchHeldLeadsForKpi`/`buildKpiData` (refator sem mudança de comportamento); `fetchSaoRanking` + `fetchSaoRateRanking` + `fetchHeldLeadsForRanking` + `buildRateRanking` (refator de hit rate/comparecimento sem mudança de comportamento); metas (schema, get/save, modal); UI (card, 2 rankings, tooltips); testes; guia dos cards.
**OUT:** SAO no Sales Hub (`get_leads_for_v4sales` não expõe o campo — story separada); backfill de feedbacks antigos (SAO retroativo não existe); seção "SDR selecionado".

## Complexity
**M**. 1 migration aditiva, 2 módulos novos, 2 services refatorados, cadeia de metas, UI.

## Risks
- Histórico curto: em setembro o card mostra 4 SAO de 21 realizadas. A linha "avaliadas de realizadas" e o tooltip explicam; sem isso o gestor lê como queda.
- "Taxa SAO" usa realizadas no denominador — reunião ainda sem feedback puxa a taxa para baixo até o closer responder (dito no tooltip).
- Meta de SAO 0 até o gestor preencher: card sem meta/ritmo e rankings sem "ideal dia" (comportamento padrão dos outros cards).
- `closer_feedback_requests` não tem índice simples em `lead_id` (só o parcial `idx_feedback_unique_pending` e os de `org_id`/`closer_id`); a consulta é por `org_id` + `lead_id IN (chunk de 200)` numa tabela pequena — registrar, não bloqueia.

## Tasks
- [x] Migration `goals.sao_target` / `goals_per_user.sao_target` (Checkpoint 1: aditiva, timestamp único `20260912095504`, `IF NOT EXISTS`, sem enum/RLS novos)
- [x] Aplicar a migration em prod (12/set, versão `20260912095504`, pedido do Vini: "aplica a migration em prod")
- [x] Regenerar `types.ts` (`pnpm gen:types`, diff de 6 linhas) — commitar separado (`chore(types): regenerate`)
- [x] `utils/latest-sao-by-lead.ts` + testes
- [x] `services/sao-feedback.service.ts` (`fetchSaoByLead`, `chunkedIn`) + testes
- [x] KPI: `fetchHeldLeadsForKpi`, `buildKpiData`, `fetchSaoKpi`; `DashboardData.saoKpi`; `get-dashboard-data` compartilha a promise; testes
- [x] Ranking: `fetchHeldLeadsForRanking`, `buildRateRanking`, `fetchSaoRanking`, `fetchSaoRateRanking`; `RankingData.sao/saoRate`; `fetchIndividualTargets` aceita `sao_target`; `get-ranking-data` itera todos os cards; testes
- [x] Metas: `saveGoalsSchema`/`userGoalSchema`, `GoalsData`/`UserGoalRow`, `get-goals`, `save-goals`, `GoalsModal`; testes
- [x] UI: `OpportunityKpiCard.subtitleExtra`; card "SAO"; rankings "SAO" e "Taxa SAO" (grid 3 colunas); tooltips de realizadas corrigidos; testes
- [x] `docs/guides/dashboard-cards.md` atualizado (SAO + regra atual de realizadas)
- [x] Conferência visual (página temporária sob `/docs/`, apagada depois) — claro e escuro OK
- [x] Checkpoint 2: `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` (2.067 testes ✅, build ✅)

## File List
- `supabase/migrations/20260912095504_goals_sao_target.sql` (novo)
- `src/lib/supabase/types.ts` (regenerado)
- `src/features/dashboard/utils/latest-sao-by-lead.ts` + `.test.ts` (novos)
- `src/features/dashboard/services/sao-feedback.service.ts` + `.test.ts` (novos)
- `src/features/dashboard/services/dashboard-metrics.service.ts` + `.test.ts`
- `src/features/dashboard/services/ranking-metrics.service.ts` + `.test.ts`
- `src/features/dashboard/types/index.ts`
- `src/features/dashboard/actions/get-dashboard-data.ts` + `.test.ts`
- `src/features/dashboard/actions/get-ranking-data.ts` + `.test.ts`
- `src/features/dashboard/actions/get-goals.ts`, `save-goals.ts`
- `src/features/dashboard/schemas/goals.schema.ts`
- `src/features/dashboard/components/GoalsModal.tsx` + `.test.tsx`
- `src/features/dashboard/components/OpportunityKpiCard.tsx`
- `src/features/dashboard/components/DashboardView.tsx` + `.test.tsx`
- `docs/guides/dashboard-cards.md`
- `docs/stories/dashboard-sao-kpi-card.story.md` (esta)

## Dev Notes
- Fonte única do SAO no Dashboard: `fetchSaoByLead` → `latestSaoByLead`. Se a regra mudar (ex.: passar a contar "não avaliada" como recusada), muda ali.
- Não confundir `oportunidade_qualificada` (SAO, aceite comercial) com `qualificacao_aderente` (a informação do pré-vendas bateu).
- Ranking de realizadas não aplica filtro de cadência (nunca aplicou); o KPI aplica. SAO espelha cada lado.
- `.or()` do PostgREST engole erro de sintaxe (zera o painel em silêncio) — a janela de realizadas continua vindo só de `meetingsHeldWindowFilter`, já validada.

## QA Results
_pendente_

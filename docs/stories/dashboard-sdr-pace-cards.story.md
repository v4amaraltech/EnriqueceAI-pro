# Story: Seção "SDR selecionado" no Dashboard — 7 cards de meta individual

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | Vini + Claude | Story criada a partir do plano aprovado ("SDR selecionado", igual ao `/sdrs` do Sales Hub). Decisões do Vini: todos podem trocar o SDR (abre no próprio usuário se for SDR); metas de ligações = 2 campos novos por SDR no "Editar metas". |
| 2026-09-11 | @dev (Dex) | Draft → InProgress. |
| 2026-09-11 | @dev (Dex) | Implementado no worktree `worktree-dashboard-sdr-pace` (base `origin/main` `0004c295`). typecheck ✅ lint ✅ testes ✅ (2.024; +27 novos) build ✅. Conferência visual por HTML estático com o CSS do build (claro, escuro, tablet): números e cores iguais ao `/sdrs`. **Pendente:** aplicar a migration em prod (a aplicação pelo MCP foi bloqueada pela permissão da sessão) e depois `pnpm gen:types`. Sem commit/push/PR (aguarda pedido do Vini). |
| 2026-09-11 | @dev (Dex) | **Migration aplicada em prod** via MCP (pedido do Vini: "aplica a migration"), versão `20260911100515` — arquivo renomeado para a mesma versão. Conferido: 2 colunas `integer NOT NULL DEFAULT 0`, 44 linhas existentes com 0. `pnpm gen:types` rodado (traz também `get_interaction_counts`, de outra migration já em prod às 09:54 UTC, fora desta story). typecheck ✅ testes ✅. |
| 2026-09-11 | @dev (Dex) | InProgress → **Ready for Review**. Commit + PR autorizados pelo Vini ("commita e abre o PR"). Branch `feat/dashboard-sdr-pace-cards` rebaseada na `origin/main` (`17d727c7`). |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint", "build"]

## Origem

O Sales Hub (`/sdrs` → "Individual", componente `PaceKpiCard`) mostra, para um SDR escolhido, 7 cards com o realizado do mês contra a meta dele: Leads Abertos, Reuniões Marcadas, Reuniões Realizadas, Total de Ligações, Ligações Conectadas, Conectada p/ Marcada e % de Conectadas. Cada card traz % atingido, barra com marcador do ideal, "hoje: N" e "faltam X · Y/dia". O time quer a mesma leitura dentro do Dashboard do EnriqueceAI, onde o SDR já trabalha.

Paridade conferida no banco antes de começar (Matheus, set/2026): Leads Abertos 91 · Marcadas 4 · Realizadas 3 · Ligações 832 · Conectadas 46. O Sales Hub mostra 91 / 4 / 3 / 834 / 46; a diferença de 2 ligações é o horário do sync.

## Story

**As a** SDR (e gestor),
**I want** ver no topo do Dashboard os meus 7 números do mês contra a minha meta, com o ritmo do dia,
**so that** eu saiba o que falta fazer hoje sem abrir o Sales Hub.

## Acceptance Criteria
1. No topo do Dashboard (abaixo do cabeçalho e dos filtros) aparece a seção "SDR selecionado", com um seletor de SDR (avatar + nome) e 7 cards.
2. A seção abre no usuário logado se ele for SDR; senão, no SDR de `?sdr=` ou no 1º SDR da lista. Qualquer usuário pode trocar o SDR; a troca atualiza `?sdr=` sem recarregar o Dashboard inteiro.
3. Os realizados usam as fontes canônicas: `count_leads_opened_by_sdr` (Leads Abertos), `leads.meeting_scheduled_at` + `assigned_to` (Marcadas), `meeting_held_at` + `meetingsHeldWindowFilter` (Realizadas), `calls` `outbound` por `user_id` no mês BRT (Ligações, inclui Callface) e `isConnectedCall` (Conectadas).
4. As metas vêm de `goals_per_user` do SDR no mês: `leads_opened_target`, `meetings_scheduled_target`, `meetings_held_target` e as novas `calls_target` e `calls_connected_target`. As metas das duas taxas são derivadas (marcadas ÷ conectadas; conectadas ÷ ligações).
5. O modal "Editar metas" ganha, por vendedor, os campos "ligações" e "conectadas", salvos em `goals_per_user`.
6. A matemática do ritmo é a do Sales Hub: % = real ÷ meta; marcador = dias úteis fechados ÷ dias úteis do mês; "hoje" = o que falta hoje para fechar o dia no ritmo (ou "no ritmo · hoje: cota"); "faltam X · Y/dia" com dias úteis restantes incluindo hoje; cores verde/amarelo/vermelho pelos mesmos cortes. Cards de taxa não têm barra nem "hoje" e dizem "na meta / acima da meta / abaixo da meta".
7. Meta 0 deixa o card neutro (sem % nem barra). Em mês passado não há marcador nem "hoje".
8. A seção segue o filtro de mês e ignora os filtros de cadência e de vendedores.

## Scope
**IN:** migration de 2 colunas em `goals_per_user`; tipos regenerados; modal de metas; service + action da seção; componentes `PaceKpiCard` e `SdrPaceSection`; esqueleto de loading; testes.
**OUT:** ranking e cards atuais do Dashboard; sync de metas do Sales Hub; qualquer mudança no Sales Hub.

## Complexity
**M**. 1 migration aditiva, 1 service, 1 action, 2 componentes novos, ajustes no modal de metas.

## Risks
- Sem metas de ligações preenchidas, os 2 cards de ligação e os 2 de taxa ficam neutros até o gestor preencher o "Editar metas".
- O "Total de Ligações" conta `type='outbound'` (discador + Callface), igual ao Sales Hub; ligações recebidas não entram.
- Diferenças pequenas com o Sales Hub são esperadas pelo horário do sync dele (até ~30 min).

## Tasks
- [x] Migration `goals_per_user.calls_target` / `calls_connected_target` (Checkpoint 1: aditiva, timestamp único, `IF NOT EXISTS`, sem enum/RLS novos)
- [x] Aplicar a migration em prod (11/set, versão `20260911100515`)
- [x] Regenerar `types.ts` (`pnpm gen:types`) — commitar separado (`chore(types): regenerate`)
- [x] Metas: schema, `get-goals`, `save-goals`, `GoalsModal`, `UserGoalRow`
- [x] Util puro de ritmo `utils/sdr-pace.ts` + testes (paridade exata com a imagem do Sales Hub de 11/set)
- [x] Service `sdr-pace.service.ts` + testes
- [x] Action `get-sdr-pace-data.ts` (`getSdrPaceData` + `getSdrPaceMetrics`, só aceita SDR da própria org)
- [x] Componentes `PaceKpiCard` e `SdrPaceSection`; inserir no `DashboardView`; esqueleto
- [x] `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`
- [x] Paridade com SQL (Matheus, set/2026: 91 / 4 / 3 / 832 / 46) e verificação visual (claro/escuro/tablet)
- [ ] Verificar no app logado após a migration (trocar SDR, mês passado, salvar metas de ligações)

## Dev Notes
- Ritmo portado de `v4-sales-hub/src/components/PaceKpiCard.tsx`, `src/lib/pace.ts` e `src/pages/SDRs.tsx` (`buildTeamKPIs`). Os dias úteis usam `utils/pacing.ts` do Enriquece (feriados nacionais fixos e móveis).
- "hoje" no Sales Hub não é o que foi feito hoje: é o que falta fazer hoje para fechar o dia no ritmo.

- A migration precisa estar em prod ANTES do deploy: `get-goals`/`save-goals` e a seção leem `calls_target`/`calls_connected_target`. Se a coluna faltar, a seção mostra erro (não zera metas em silêncio).
- `getMonthRange` do ranking passou a ser exportado para a seção usar a mesma janela de contagem.

## File List
- `docs/stories/dashboard-sdr-pace-cards.story.md`
- `supabase/migrations/20260911100515_goals_per_user_calls_targets.sql`
- `src/lib/supabase/types.ts` (gerado — `pnpm gen:types`)
- `src/app/(app)/dashboard/page.tsx`
- `src/features/dashboard/types/index.ts`
- `src/features/dashboard/schemas/goals.schema.ts`
- `src/features/dashboard/actions/get-goals.ts`
- `src/features/dashboard/actions/save-goals.ts`
- `src/features/dashboard/actions/save-goals.test.ts`
- `src/features/dashboard/actions/get-sdr-pace-data.ts`
- `src/features/dashboard/services/ranking-metrics.service.ts`
- `src/features/dashboard/services/sdr-pace.service.ts`
- `src/features/dashboard/services/sdr-pace.service.test.ts`
- `src/features/dashboard/utils/sdr-pace.ts`
- `src/features/dashboard/utils/sdr-pace.test.ts`
- `src/features/dashboard/components/PaceKpiCard.tsx`
- `src/features/dashboard/components/SdrPaceSection.tsx`
- `src/features/dashboard/components/SdrPaceSection.test.tsx`
- `src/features/dashboard/components/DashboardView.tsx`
- `src/features/dashboard/components/DashboardSkeleton.tsx`
- `src/features/dashboard/components/GoalsModal.tsx`
- `src/features/dashboard/components/GoalsModal.test.tsx`

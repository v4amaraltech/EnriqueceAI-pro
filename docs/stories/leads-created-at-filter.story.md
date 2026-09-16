# Story: Filtro "Criado em" e coluna "Criado em" na tela de Leads

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-16 | @dev (Dex) | Commit `e61aa0e5` + **PR #427** aberto (autorizado pelo Vini: "Pode comiitar" / "E abrir PR"). Aguardando CI e revisão. |
| 2026-09-16 | @dev (Dex) | Implementado: helper `createdAtRange` (BRT), campos `created_period`/`created_from`/`created_to` no schema, filtro aplicado em `fetchLeads`/`fetchFilteredLeadIds`/`exportAllFilteredLeadsCsv`, seletor "Criado em" (Hoje, Ontem, Últimos 7 dias, Este mês, Personalizado de/até) em `LeadFilters`, coluna "Criado em" ordenável em `LeadTable` (Hoje HH:mm em destaque, Ontem, há N dias, dd/MM, dd/MM/aa + tooltip). typecheck ✅ lint ✅ testes ✅ (+22, 453 no módulo). Verificação visual em página temporária sob `/docs/` (apagada). Sem commit — aguardando o Vini. |
| 2026-09-16 | Vini + Claude | Story criada. Dor trazida pelos pré-vendas: não conseguem separar os leads adicionados "Hoje" dos antigos na tela de Leads. Opções apresentadas (1 filtro de período, 2 coluna de data, 3 selo "Novo hoje"); Vini aprovou a recomendação 1 + 2. |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

A tela `/leads` já ordena por `created_at` decrescente por padrão, mas isso é invisível: a tabela não mostra a data de criação, o cabeçalho não permite ordenar por data e não existe filtro de período. O SDR vê a lista e não sabe onde terminam os leads de hoje e começam os de ontem.

## Story

**As a** SDR,
**I want** filtrar a tela de Leads por data de criação (Hoje, Ontem, Últimos 7 dias, Este mês ou um período) e ver a data de criação em cada linha,
**so that** eu separe os leads que acabaram de entrar dos antigos sem precisar adivinhar pela ordem da lista.

## Acceptance Criteria
1. A barra de filtros tem um seletor **"Criado em"** com: Todos, Hoje, Ontem, Últimos 7 dias, Este mês, Personalizado (de/até).
2. O período é calculado em **BRT** (UTC-3): "Hoje" às 22h de Brasília ainda é o dia de hoje, não o dia seguinte em UTC.
3. O filtro fica na URL (`created_period=today` ou `created_from`/`created_to`), então "Hoje" pode ser salvo como favorito e continua correto amanhã.
4. O filtro vale para a lista, para o "selecionar todos os filtrados" e para a exportação CSV filtrada (mesma fonte de verdade).
5. A tabela tem uma coluna **"Criado em"** ordenável (cabeçalho clicável), mostrando "Hoje HH:mm", "Ontem", "há N dias" ou "dd/MM", com a data completa no tooltip.
6. "Limpar" remove o filtro; o contador "N leads encontrados" respeita o filtro.

## Scope
**IN:** schema de filtros, `fetchLeads`, `fetchFilteredLeadIds`, `exportAllFilteredLeadsCsv`, `LeadFilters`, `LeadTable`, página `/leads`, helper de período em BRT, testes.
**OUT:** selo "Novo hoje" (opção 3, não aprovada); contagens das abas de status (continuam globais, como hoje); Sales Hub.

## Complexity
**S**. Sem migration. 1 helper novo + ajustes em 6 arquivos existentes.

## Risks
- A busca por texto ignora os demais filtros (regra existente: "sempre achar o lead"). O filtro de data segue a mesma regra na lista para não quebrar a expectativa atual.
- Coluna nova aumenta a largura da tabela; a coluna é estreita (`whitespace-nowrap`).

## Tasks
- [x] Helper `createdAtRange` (BRT) + testes
- [x] Schema: `created_period`, `created_from`, `created_to` + testes
- [x] Aplicar o período em `fetchLeads`, `fetchFilteredLeadIds`, `exportAllFilteredLeadsCsv` + teste
- [x] Página `/leads` passa os params e conta como filtro ativo
- [x] `LeadFilters`: seletor "Criado em" + período personalizado (+5 testes)
- [x] `LeadTable`: coluna "Criado em" ordenável + formatador + testes
- [x] typecheck, lint, testes

## Dev Notes
- Reusa `brtTodayIso` / `brtDayStartIso` / `brtDayEndIso` de `src/lib/utils/brt-date.ts`.
- `sort_by=created_at` já existia no schema; só faltava o cabeçalho.

## File List
- `src/lib/utils/brt-date.ts` (+ `brtDateIso`, `addDaysIso`)
- `src/features/leads/utils/created-at-range.ts` (+ `.test.ts`)
- `src/features/leads/utils/format-created-at.ts` (+ `.test.ts`)
- `src/features/leads/schemas/lead.schemas.ts` (+ `.test.ts`)
- `src/features/leads/actions/fetch-leads.ts` (+ `.test.ts`)
- `src/features/leads/actions/export-all-filtered-leads-csv.ts`
- `src/app/(app)/leads/page.tsx`
- `src/features/leads/components/LeadFilters.tsx` (+ `.test.tsx`, novo)
- `src/features/leads/components/LeadTable.tsx` (+ `.test.tsx`)
- `docs/stories/leads-created-at-filter.story.md`

# Epic 5: Reports & Analytics Pro

**Status:** Draft
**Created:** 2026-03-18
**Author:** @pm (Morgan)
**Priority:** HIGH
**Total Stories:** 5 (2 Waves)

---

## Epic Goal

Elevar os relatórios e estatísticas do Flux de funcional para profissional, permitindo que managers escolham períodos customizados, comparem performance entre períodos, exportem relatórios em PDF, façam drill-down de métricas agregadas para dados granulares, e tenham uma experiência de filtros unificada entre Reports e Statistics.

## Existing System Context

- **Tech Stack:** Next.js 16 (App Router), React 19, Supabase (PostgreSQL 17 + Auth + Realtime), Tailwind CSS v4 + shadcn/ui, TypeScript strict
- **Current State:** 37 stories Done (Epics 1-4). Reports com 3 views (Overall, Cadence, SDR) + CSV export. Statistics com 8 módulos analíticos (Activity, Conversion, Call, Email, Team, Cadence, Loss Reason, Performance) + 28 componentes de visualização. Dashboard com KPI, ranking e insights.
- **Pattern:** Feature modules verticais (`src/features/{name}/`), Server Actions com `ActionResult<T>`, RLS multi-tenant
- **Current Filters:** Presets fixos (today/7d/30d/90d) em Statistics, (7d/30d/90d) em Reports. Filtro por SDR e cadência em Statistics. Sem date range customizado.

## What Already Exists

| Feature | Status | Location |
|---------|--------|----------|
| Reports (Overall/Cadence/SDR) | Complete | `src/features/reports/` |
| Statistics (8 módulos) | Complete | `src/features/statistics/` |
| Dashboard (KPI/Ranking) | Complete | `src/features/dashboard/` |
| Period presets (7d/30d/90d) | Complete | `StatisticsFilters`, `ReportsView` |
| CSV export | Complete | `reports/utils/csv-export.ts` |
| SDR/Cadence filters | Partial | Statistics only, not Reports |
| Custom date range | Missing | — |
| Period comparison | Missing | — |
| PDF export | Missing | — |
| Drill-down | Missing | — |

## Quality Gate Standard

Todas as stories seguem:
- **Gate:** `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` passando
- **Testing:** Testes unitários para lógica de cálculo, testes de componente para UI
- **Compatibility:** Reports e Statistics existentes devem continuar funcionando sem regressão

---

## Wave Structure

| Wave | Foco | Stories | Points |
|------|------|---------|--------|
| **Wave 1** | Foundation — Filtros e Comparação | 5.1, 5.2, 5.5 | 11 |
| **Wave 2** | Output — Export e Drill-down | 5.3, 5.4 | 10 |
| | | **Total** | **21** |

---

## Wave 1: Foundation — Filtros e Comparação

### Story 5.1: Custom Date Range Picker

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 3

**Objetivo:** Substituir os presets fixos de período por um componente de date range reutilizável que suporte tanto presets rápidos quanto seleção customizada de datas.

**Scope IN:**
- Componente `DateRangePicker` em `src/shared/components/` baseado em Radix Popover + calendar
- Presets rápidos mantidos (Hoje, 7d, 30d, 90d) como atalhos dentro do picker
- Seleção customizada com calendário (data início e fim)
- Parâmetros de URL: `from` e `to` (ISO date strings) substituindo `period`
- Migrar `StatisticsFilters` para usar o novo componente
- Migrar `ReportsView` period selector para usar o novo componente
- Migrar `PeriodFilter` do Dashboard para usar o novo componente
- Limite máximo de range: 365 dias
- Default: últimos 30 dias quando nenhum período selecionado

**Scope OUT:**
- Comparação entre períodos (Story 5.2)
- Presets relativos complexos ("último trimestre", "YTD")

**Acceptance Criteria:**
- [ ] Componente `DateRangePicker` renderiza com presets e calendário customizado
- [ ] Seleção de preset atualiza URL params `from`/`to` e refetch dados
- [ ] Seleção customizada permite escolher início e fim com validação (fim >= início, range <= 365d)
- [ ] Statistics, Reports e Dashboard usam o novo componente (presets antigos removidos)
- [ ] URLs com `from`/`to` são shareable (copiar URL preserva filtro)
- [ ] Testes unitários para validação de range e conversão de presets
- [ ] Sem regressão nas 3 telas (dados carregam corretamente com novos params)

**Technical Notes:**
- Usar `date-fns` (já no projeto) para manipulação de datas
- Considerar `react-day-picker` ou implementar calendário com Radix primitives
- Server Actions devem aceitar `from`/`to` como `Date` ou ISO string

---

### Story 5.2: Comparação Período-a-Período

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Permitir que managers comparem métricas entre dois períodos (ex: esta semana vs semana passada) com indicadores visuais de tendência (delta %).

**Scope IN:**
- Toggle "Comparar com período anterior" no `DateRangePicker`
- Quando ativo, calcula automaticamente o período anterior de mesmo tamanho (ex: 30d selecionado → compara com 30d anteriores)
- Delta % calculado para todas as métricas numéricas em Reports (Overall, Cadence, SDR)
- Delta % calculado para KPIs em Statistics (Activity, Conversion, Team)
- Componente `DeltaIndicator` reutilizável: seta ↑/↓, cor verde/vermelho, valor %
- Tooltip no `DeltaIndicator` mostrando valor absoluto do período anterior
- Serviço de comparação: recebe dados de 2 períodos, retorna deltas

**Scope OUT:**
- Comparação com período customizado (só período anterior automático)
- Gráficos overlay (2 linhas no mesmo chart)
- Comparação YoY (year-over-year)

**Acceptance Criteria:**
- [ ] Toggle "Comparar" visível no `DateRangePicker`, desativado por default
- [ ] Ao ativar, dados do período anterior são buscados em paralelo
- [ ] `DeltaIndicator` mostra ↑ verde para melhoria, ↓ vermelho para piora
- [ ] Métricas de Reports (Overall): leads, contacted, replied, meetings, qualified mostram delta
- [ ] Métricas de Statistics (Activity KPIs): total atividades, média/dia mostram delta
- [ ] Tooltip no indicator mostra: "Período anterior: X (delta %)"
- [ ] Performance: queries do período anterior não degradam tempo de carregamento > 50%
- [ ] Testes unitários para cálculo de delta (inclusive edge cases: divisão por zero, valores negativos)

**Technical Notes:**
- Fetch paralelo: `Promise.all([fetchCurrent, fetchPrevious])`
- `safeRate()` já existe no codebase para divisão segura
- Período anterior: `subDays(from, diffDays)` a `subDays(to, diffDays)`

**Dependencies:** Story 5.1 (Custom Date Range Picker)

---

### Story 5.5: Report Filters Unification

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 3

**Objetivo:** Unificar a experiência de filtros entre Reports e Statistics, permitindo que ambos filtrem por SDR, cadência e origem de forma consistente.

**Scope IN:**
- Adicionar filtro por SDR no `ReportsView` (atualmente só Statistics tem)
- Adicionar filtro por cadência no `ReportsView` (atualmente só Statistics tem)
- Componente compartilhado `AnalyticsFilters` em `src/shared/components/` com: DateRangePicker + SDR select + Cadence select
- Migrar `StatisticsFilters` para usar `AnalyticsFilters`
- Migrar `ReportsView` para usar `AnalyticsFilters`
- URL params unificados: `from`, `to`, `sdr`, `cadence`

**Scope OUT:**
- Filtro por origem (lead source) — complexidade adicional desnecessária agora
- Filtros salvos / presets de filtro
- Filtro no Dashboard (mantém `PeriodFilter` próprio por ter UX diferente)

**Acceptance Criteria:**
- [ ] `AnalyticsFilters` renderiza DateRangePicker + SDR multi-select + Cadence select
- [ ] Reports filtra por SDR: Overall/Cadence/SDR tables refletem seleção
- [ ] Reports filtra por cadência: tabelas mostram apenas cadência selecionada
- [ ] Statistics continua funcionando com os mesmos filtros (sem regressão)
- [ ] URL params compartilhados entre Reports e Statistics
- [ ] Testes de componente para `AnalyticsFilters`

**Dependencies:** Story 5.1 (Custom Date Range Picker)

---

## Wave 2: Output — Export e Drill-down

### Story 5.3: Exportação PDF

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Permitir exportação dos relatórios em PDF com layout profissional, gerado client-side.

**Scope IN:**
- Botão "Exportar PDF" ao lado do "Exportar CSV" existente em `ReportsView`
- Geração client-side com `html2canvas` + `jsPDF`
- Layout PDF: header com logo/org name, período, tabelas formatadas, footer com data de geração
- Exportar cada tab como seção no PDF (Overall, Cadence, SDR)
- Loading state durante geração ("Gerando PDF...")
- Nome do arquivo: `relatorio-{tipo}-{from}-{to}.pdf`
- Suporte a tema claro para PDF (forçar light mode no snapshot)

**Scope OUT:**
- Exportação de Statistics (escopo futuro — muitos charts complexos)
- Agendamento de exportação automática
- Exportação server-side (Puppeteer)
- Customização de layout pelo usuário

**Acceptance Criteria:**
- [ ] Botão "Exportar PDF" visível em `ReportsView`
- [ ] PDF gerado contém: header com nome da org + período selecionado
- [ ] Seção "Visão Geral" com funil e métricas
- [ ] Seção "Por Cadência" com tabela de métricas por cadência
- [ ] Seção "Por SDR" com tabela de métricas por SDR
- [ ] Se comparação ativa (5.2), deltas aparecem no PDF
- [ ] Footer com timestamp de geração
- [ ] Loading state exibido durante geração
- [ ] PDF legível em A4 landscape, tabelas não cortadas
- [ ] Testes: verificar que função de export é chamada com parâmetros corretos

**Technical Notes:**
- `html2canvas` para capturar DOM → canvas, `jsPDF` para canvas → PDF
- Renderizar em div oculta com tema claro forçado para consistência
- Considerar `@react-pdf/renderer` como alternativa se html2canvas tiver problemas de qualidade

**Dependencies:** Story 5.2 (para incluir deltas no PDF quando comparação ativa)

---

### Story 5.4: Drill-down Summary → Detalhe

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Permitir que managers cliquem em qualquer métrica agregada para ver os dados granulares que a compõem, em um drawer lateral.

**Scope IN:**
- Componente `DrilldownDrawer` em `src/shared/components/`: sheet lateral com tabela paginada
- Reports Overall: click em "Replied" → drawer lista leads que responderam, com nome, cadência, data
- Reports Cadence: click em cadência → drawer lista enrollments dessa cadência com status
- Reports SDR: click em SDR → drawer lista atividades desse SDR no período
- Statistics Activity KPI: click em total → drawer lista atividades individuais
- Statistics Conversion funnel: click em stage → drawer lista leads naquele stage
- Server Action `fetchDrilldownData(metric, filters)` genérica com paginação
- Paginação no drawer (25 itens por página)
- Link "Ver lead" em cada row do drill-down (abre `/leads/{id}`)

**Scope OUT:**
- Drill-down em gráficos/charts (apenas KPIs e tabelas)
- Export do drill-down (CSV/PDF)
- Drill-down recursivo (drill-down dentro de drill-down)
- Drill-down no Dashboard (mantém escopo em Reports e Statistics)

**Acceptance Criteria:**
- [ ] Click em métrica no Reports Overall abre drawer com dados relevantes
- [ ] Click em row na tabela de Cadence abre drawer com enrollments
- [ ] Click em row na tabela de SDR abre drawer com atividades do SDR
- [ ] Click em KPI no Statistics Activity abre drawer com atividades
- [ ] Click em stage no funil de Conversion abre drawer com leads
- [ ] Drawer mostra tabela paginada (25/página) com colunas contextuais
- [ ] Cada row tem link para o lead correspondente
- [ ] Loading state enquanto dados são buscados
- [ ] Testes unitários para `fetchDrilldownData` com diferentes tipos de métricas

**Technical Notes:**
- Usar `Sheet` do shadcn/ui (Radix Dialog) para o drawer
- Server Action genérica que aceita `{ metric: string, filters: object, page: number }`
- Retornar `{ data: Row[], total: number, page: number }` para paginação

**Dependencies:** Story 5.5 (filtros unificados para consistência nos dados do drill-down)

---

## Dependency Graph

```
5.1 (Date Range Picker)
 ├── 5.2 (Comparação Período-a-Período)
 │    └── 5.3 (Exportação PDF)
 └── 5.5 (Filter Unification)
      └── 5.4 (Drill-down)
```

## Risk Mitigation

- **Primary Risk:** Regressão nos Reports e Statistics existentes ao migrar filtros
- **Mitigation:** Testes de componente antes/depois da migração; manter backward compatibility nos URL params durante transição
- **Rollback Plan:** DateRangePicker aceita presets como fallback; toggle de comparação desativado por default

## Compatibility Requirements

- [ ] Todas as URLs existentes de Reports/Statistics continuam funcionando
- [ ] CSV export existente não é afetado
- [ ] Dashboard `PeriodFilter` mantém UX atual (não migra para `AnalyticsFilters`)
- [ ] Performance de carregamento não degrada > 50% com comparação ativa

## Definition of Done

- [ ] Todas as 5 stories completas com acceptance criteria atendidos
- [ ] `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` passando
- [ ] Reports e Statistics existentes sem regressão
- [ ] Filtros consistentes entre Reports e Statistics
- [ ] PDF exportável e legível
- [ ] Drill-down funcional para métricas principais

# Story: Tela de Feedback de Oportunidade

## Status: Draft

## Story

**Como** gestor de vendas,
**Quero** visualizar os feedbacks dos closers sobre as oportunidades enviadas,
**Para** entender a qualidade dos leads qualificados, taxa de resposta dos closers, e resultados das reuniões.

## Contexto

Atualmente o menu "Feedback de Oportunidade" em Estatísticas aponta para a tela de Conversão, que mostra dados de funil (leads, contactados, qualificados). Não existe uma tela dedicada para feedbacks das oportunidades enviadas aos closers.

### Dados Disponíveis

**Tabela `closer_feedback_requests`:**
- `id`, `org_id`, `lead_id`, `closer_id`, `token`
- `result` (enum: `meeting_done`, possivelmente outros)
- `rating` (1-5)
- `comment` (texto livre)
- `sent_at`, `responded_at`, `expires_at`
- `reminder_sent_at`

**Tabela `closers`:**
- `id`, `name`, `email`, `org_id`

**Dados atuais (Abril 2026):**
- 68 feedbacks totais, 41 respondidos, 27 pendentes
- Rating médio: 3.97/5
- 2 closers: Jhonata Banqueri, Vinicius Mercante

## Acceptance Criteria

### AC1: KPI Cards
- [ ] Total de oportunidades enviadas no período
- [ ] Taxa de resposta (respondidos / total)
- [ ] Rating médio dos feedbacks
- [ ] Tempo médio de resposta (sent_at → responded_at)

### AC2: Tabela de Feedbacks
- [ ] Lista de feedbacks com: Lead (nome), Closer, Resultado, Rating (estrelas), Data envio, Data resposta, Status (respondido/pendente/expirado)
- [ ] Ordenação por data
- [ ] Filtro por closer
- [ ] Filtro por período (date range picker)
- [ ] Filtro por status (respondido/pendente)
- [ ] Click no lead abre o lead detail

### AC3: Ranking de Closers
- [ ] Card com ranking dos closers por: oportunidades recebidas, taxa de resposta, rating médio
- [ ] Gráfico de barras comparativo

### AC4: Comentários Recentes
- [ ] Seção com últimos comentários dos closers
- [ ] Mostra: closer name, lead name, rating, comentário, data
- [ ] Máximo 10 mais recentes

### AC5: Integração no Menu
- [ ] Menu "Feedback de Oportunidade" aponta para `/statistics/feedback`
- [ ] Breadcrumb: Estatísticas > Feedback de Oportunidade
- [ ] Acessível apenas para managers

## Scope

### IN
- Server action `fetchFeedbackAnalytics`
- Página `/statistics/feedback/page.tsx`
- Componentes: FeedbackKpis, FeedbackTable, CloserRankingCard, RecentCommentsCard
- Filtros por closer, período, status
- Rota no menu de Estatísticas

### OUT
- Edição de feedbacks (já existe na tela de feedback do closer)
- Envio de novos feedbacks (já existe no markLeadAsWon)
- Notificações de feedback (já existe)

## Dev Notes

- Usar padrão existente de statistics services (ver `team-analytics.service.ts`)
- Reutilizar `DateRangePicker` e filtros do padrão de statistics
- Rating como estrelas (1-5) usando componente existente ou lucide-react Star
- Não esquecer `.limit(10000)` nas queries
- Página é manager-only (usar `getManagerOrgId()`)

## Tasks

- [ ] 1. Criar types em `src/features/statistics/types/feedback-analytics.types.ts`
- [ ] 2. Criar service `src/features/statistics/services/feedback-analytics.service.ts`
- [ ] 3. Criar action `src/features/statistics/actions/fetch-feedback-analytics.ts`
- [ ] 4. Criar página `src/app/(app)/statistics/feedback/page.tsx`
- [ ] 5. Criar componentes: FeedbackKpis, FeedbackTable, CloserRankingCard, RecentCommentsCard
- [ ] 6. Atualizar menu TopBar: href de `/statistics/conversion` para `/statistics/feedback`
- [ ] 7. Atualizar página index de statistics com descrição correta
- [ ] 8. Testes de schema/service

## File List

*(a ser preenchido durante implementação)*

## Change Log

| Data | Mudança |
|------|---------|
| 2026-04-23 | Story criada |

## Dev Agent Record

### Agent Model Used
*(a ser preenchido)*

### Debug Log
*(a ser preenchido)*

### Completion Notes
*(a ser preenchido)*

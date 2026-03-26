# Epic 5: CRM Integration, Calendar & Reporting

**Goal:** Fechar o ciclo completo de vendas com sincronização bidirecional de CRMs, agendamento de reuniões via Google Calendar, relatórios de performance e gestão de planos/billing.

## Story 5.1 — CRM Integration Framework & HubSpot

> As a **SDR**,
> I want to connect HubSpot to the platform and sync my leads automatically,
> so that I don't need to update data manually in two systems.

**Acceptance Criteria:**

1. Service `CRMService` com interface abstrata
2. Tabela `crm_connections` e `crm_sync_log`
3. Card "HubSpot" com fluxo OAuth2 completo
4. Mapeamento de campos configurável
5. Sync bidirecional: leads e atividades
6. Atividades da cadência sincronizadas como Activities/Notes
7. Sync automático via Edge Function a cada 30 min + botão manual
8. Conflito handling: last-write-wins com log
9. Status de sync visível
10. Testes para adapter HubSpot

## Story 5.2 — Pipedrive & RD Station CRM Adapters

> As a **SDR using Pipedrive or RD Station**,
> I want to connect my CRM to the platform,
> so that I have the same sync experience regardless of my CRM.

**Acceptance Criteria:**

1. Adapter `PipedriveAdapter` implementando `CRMService`
2. Adapter `RDStationAdapter` implementando `CRMService`
3. Cards na página de integrações com OAuth2
4. Mapeamento de campos específico por CRM
5. Mesma lógica de sync bidirecional
6. Mesma lógica de sync automático e conflict handling
7. Constraint: apenas um CRM por organização
8. Indicador visual de qual CRM está conectado
9. Documentação inline sobre configuração
10. Testes por adapter com mock das APIs

## Story 5.3 — Google Calendar Integration

> As a **SDR**,
> I want to schedule meetings directly from the platform to my Google Calendar,
> so that I convert leads to meetings without leaving EnriqueceAI.

**Acceptance Criteria:**

1. Card "Google Calendar" com fluxo OAuth2
2. Botão "Agendar reunião" no perfil do lead
3. Modal de agendamento: título, data/hora, duração, descrição, participantes
4. Verificação de disponibilidade (Free/Busy)
5. Evento criado com convite enviado ao lead
6. Google Meet link gerado automaticamente
7. Interação registrada como `meeting_scheduled`
8. Timeline do lead atualizada
9. Step "Agendar reunião" como opção na cadência
10. Testes para criação de evento

## Story 5.4 — Reporting & Analytics

> As a **manager**,
> I want detailed performance reports for the team and cadences,
> so that I make data-driven decisions about sales operations.

**Acceptance Criteria:**

1. Página `/reports` com 3 views: Por Cadência, Por SDR, Geral
2. Report por Cadência: abertura, resposta, bounce, conversão, tempo até resposta
3. Report por SDR: leads trabalhados, mensagens, respostas, reuniões, conversão
4. Report Geral: funil de conversão completo
5. Filtro de período (7d, 30d, 90d, custom)
6. Gráficos visuais (Recharts ou similar)
7. Exportar como CSV
8. Queries otimizadas (views/functions)
9. Cache com invalidação por nova atividade
10. Responsivo
11. Testes para cálculos de métricas

## Story 5.5 — Billing & Plan Management

> As a **manager**,
> I want to manage my account plan and add new users,
> so that my team grows as needed paying per additional member.

**Acceptance Criteria:**

1. Página `/settings/billing` acessível por manager
2. Exibição do plano atual com detalhes
3. 3 planos: **Starter** (3+1, 1k leads, 50 IA/dia, enrichment básico, 500 WhatsApp msgs, R$149/mês + R$49/user adicional), **Pro** (3+1, 5k leads, 200 IA/dia, enrichment Lemit, CRM, 2.500 WhatsApp msgs, R$349/mês + R$89/user adicional), **Enterprise** (3+1, 10k leads, IA ilimitada, todas integrações, 10k WhatsApp msgs, R$699/mês + R$129/user adicional)
4. Cobrança por usuário adicional acima de 3+1 conforme pricing por plano
5. Tabelas `plans`, `subscriptions` e `whatsapp_credits` (org_id, plan_credits, used_credits, overage_count, period)
6. Integração Stripe (placeholder preparado)
7. Feature flags baseadas no plano
8. Alerta de aproximação de limite
9. Página de upgrade com comparativo
10. Histórico de faturas (placeholder)
11. Testes para feature flags e limites

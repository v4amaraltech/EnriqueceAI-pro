# EnriqueceAI — Product Requirements Document (PRD)

## Goals and Background Context

### Goals

- Eliminar o trabalho manual e repetitivo dos SDRs/BDRs em operações B2B de Startups, PMEs e Mid-market
- Fornecer enriquecimento automático de leads via CNPJ (dados firmográficos + contato) para eliminar pesquisa manual
- Oferecer geração de mensagens personalizadas com IA para WhatsApp e Email, aumentando produtividade e taxa de resposta
- Criar cadências de engajamento omnichannel (WhatsApp + Email) com fluxos lineares automatizados
- Integrar com CRMs existentes (HubSpot, Pipedrive, RD Station) e Google Calendar para ciclo de vendas completo
- Entregar uma alternativa moderna à Meetime com IA nativa e WhatsApp como canal de primeira classe

### Background Context

O mercado brasileiro de Sales Engagement é dominado pela Meetime, que atende bem operações tradicionais de outbound por email e telefone. No entanto, a realidade do vendedor B2B brasileiro mudou: WhatsApp se tornou o canal principal de comunicação comercial, e times menores (2-50 reps) precisam de ferramentas que maximizem a produtividade individual sem exigir processos complexos.

A EnriqueceAI nasce para preencher esse gap — uma plataforma com IA embarcada que enriquece leads automaticamente via CNPJ, gera mensagens personalizadas para cada canal, e orquestra cadências simples mas eficazes. O foco no MVP é demonstrar valor imediato através de enriquecimento em massa + dashboard inteligente, evoluindo para cadências automatizadas e geração com IA nas fases seguintes.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-02-18 | 0.1 | Initial PRD draft from requirements gathering | Morgan (PM) |
| 2026-02-18 | 0.2 | Added Competitive Analysis, Market Sizing, Pricing Strategy, CNPJ Enrichment Strategy | Morgan (PM) + Atlas (Analyst) |

---

## Competitive Analysis

> Full report: `docs/research/competitive-intelligence-report.md`

### Market Landscape

O mercado global de Sales Engagement está avaliado em ~USD $9-10 bilhões (2025), com projeção de USD $25-36 bilhões até 2033 (CAGR 13-16%). No Brasil, o TAM estimado é de R$500M-1B/ano, com SAM de R$200-400M/ano para o ICP do EnriqueceAI (Startups, PMEs e Mid-market B2B).

### Competitive Positioning

| Dimensão | **EnriqueceAI** | **Meetime** | **Exact Spotter** | **Apollo.io** |
|----------|:-:|:-:|:-:|:-:|
| WhatsApp Nativo | ✅ 1st class | ⚠️ Básico | ✅ Integrado | ❌ |
| IA Geração de Mensagens | ✅ | ❌ | ❌ | ⚠️ Básico |
| Enrichment CNPJ | ✅ Nativo | ❌ | ❌ | ❌ |
| Discador/Telefone | ❌ (futuro) | ✅ | ✅ | ✅ |
| Base de Contatos | ❌ | ❌ | ⚠️ Big Data | ✅ 210M+ |
| CRM (HubSpot/Pipedrive/RD) | ✅ | ✅ | ❌ | ✅ (sem RD) |
| Idioma PT-BR | ✅ | ✅ | ✅ | ❌ |
| Custo de Implementação | R$0 | Não público | R$5.000 | R$0 |

### Key Competitive Gaps Exploited

1. **Nenhum concorrente brasileiro integra WhatsApp + IA generativa + Enrichment CNPJ** numa única solução
2. **Meetime** não tem IA para geração de mensagens (apenas transcrição de calls) e WhatsApp é canal secundário
3. **Exact Spotter** cobra R$5.000 de implementação e R$211/usuário adicional — barreira para PMEs
4. **Apollo.io** não tem WhatsApp, dados fracos para empresas brasileiras, preço em USD

### CNPJ Enrichment Strategy (Camadas)

| Camada | Provider | Dados | Custo | Plano EnriqueceAI |
|--------|----------|-------|-------|-----------|
| **Básica** | CNPJ.ws / ReceitaWS | Razão social, CNAE, endereço, porte, situação | Gratuito (rate limited) | Starter |
| **Contato** | Lemit | Emails, telefones validados, sócios, faturamento | Sob consulta (pré/pós-pago) | Pro |
| **Premium** | Serasa / CPF.CNPJ | Score de crédito, risco financeiro | Premium | Enterprise (futuro) |

### WhatsApp Business API — Custos

| Tipo de Mensagem | Custo/msg (Brasil) | Uso na Plataforma |
|-----------------|-------------------|-------------------|
| Marketing | ~R$0,35 | Outbound frio (primeiro contato via template) |
| Utilidade | ~R$0,05 | Confirmações, follow-ups |
| Serviço (24h) | Grátis (a partir jul/2025) | Respostas a leads |

**Implicação:** Custos de WhatsApp API devem ser repassados como créditos incluídos por plano, com cobrança por excedente.

### Pricing Strategy

| Plano | Base (3 SDRs + 1 Gerente) | Adicional/usuário | Enrichment | IA/dia | WhatsApp/mês |
|-------|--------------------------|-------------------|-----------|--------|-------------|
| **Starter** | R$149/mês | +R$49/user | Básico (Receita Federal) | 50 gerações | 500 msgs |
| **Pro** | R$349/mês | +R$89/user | Contato (Lemit) + CRM | 200 gerações | 2.500 msgs |
| **Enterprise** | R$699/mês | +R$129/user | Full + todas integrações | Ilimitado | 10.000 msgs |

*Posicionado abaixo da Meetime (~R$200-400/user) e sem custo de implementação (vs Exact R$5.000).*

### Success Metrics & KPIs

| KPI | Baseline (Mercado) | Meta EnriqueceAI (12 meses) |
|-----|-------------------|---------------------|
| Conversão lead → reunião | 5-8% (média BR) | 12-15% (com IA + WhatsApp) |
| Produtividade SDR (leads/dia) | 30-50 | 80-120 (com enrichment + IA) |
| Taxa de resposta WhatsApp | 40-60% (mercado) | 50-70% (com personalização IA) |
| Taxa de resposta Email | 5-10% (cold outreach) | 10-15% (com personalização IA) |
| Churn mensal | 5-8% (SaaS BR) | <5% |
| NPS | 30-50 (Meetime benchmark) | >50 |
| MRR ao final de 12 meses | - | R$50.000+ |

---

## Requirements

### Functional

- **FR1:** O sistema deve permitir importação de leads em massa via arquivo CSV/planilha contendo CNPJs
- **FR2:** O sistema deve enriquecer automaticamente leads importados via CNPJ, retornando dados firmográficos (razão social, nome fantasia, endereço, porte, CNAE, situação cadastral) e dados de contato (email, telefone, sócios, faturamento estimado) através de integração com Lemit ou provedor similar
- **FR3:** O sistema deve exibir um dashboard de leads com visualização dos dados enriquecidos, filtros por porte/segmento/localização e métricas de importação
- **FR4:** O sistema deve permitir criação de cadências lineares com sequência fixa de passos configuráveis (canal, conteúdo, intervalo entre passos)
- **FR5:** O sistema deve enviar emails automatizados via integração com Gmail/Google Workspace (OAuth2)
- **FR6:** O sistema deve enviar mensagens automatizadas via integração com WhatsApp Business API
- **FR7:** O sistema deve gerar mensagens personalizadas com IA (email e WhatsApp) baseadas no perfil enriquecido do lead
- **FR8:** O sistema deve integrar com CRMs (HubSpot, Pipedrive, RD Station CRM) para sincronização bidirecional de leads e atividades
- **FR9:** O sistema deve integrar com Google Calendar para agendamento de reuniões diretamente a partir da cadência
- **FR10:** O sistema deve fornecer autenticação e gerenciamento de usuários com suporte a múltiplos membros por conta (time de SDRs)
- **FR11:** O sistema deve permitir gestão de templates de mensagens (email e WhatsApp) com variáveis dinâmicas do lead
- **FR12:** O sistema deve registrar histórico completo de interações por lead (emails enviados, WhatsApp, aberturas, cliques, respostas)
- **FR13:** O sistema deve exibir métricas de performance por cadência (taxa de abertura, resposta, conversão, bounce)

### Non-Functional

- **NFR1:** A plataforma deve ser construída com Next.js + Supabase, utilizando o tech preset nextjs-react como base
- **NFR2:** O tempo de enriquecimento por CNPJ deve ser inferior a 5 segundos por lead individualmente, com processamento em batch para importações em massa
- **NFR3:** A plataforma deve suportar até 10.000 leads ativos por conta no plano mais alto sem degradação de performance
- **NFR4:** A interface deve ser web responsive, priorizando desktop mas funcional em dispositivos móveis
- **NFR5:** A plataforma deve seguir padrões de segurança para dados sensíveis (LGPD compliance), com criptografia de dados em repouso e em trânsito
- **NFR6:** O sistema deve ter disponibilidade mínima de 99.5% (uptime)
- **NFR7:** As integrações com APIs externas (Lemit, WhatsApp, Gmail, CRMs) devem implementar retry com backoff exponencial e circuit breaker
- **NFR8:** O modelo de monetização deve incluir no plano base mínimo 3 usuários (SDRs) + 1 gerente, com cobrança adicional por cada novo usuário adicionado à conta
- **NFR9:** O sistema de enriquecimento deve suportar estratégia em camadas: dados gratuitos da Receita Federal (CNPJ.ws/ReceitaWS) para plano Starter, dados de contato via Lemit para plano Pro+
- **NFR10:** Os custos de WhatsApp Business API (~R$0,35/msg marketing) devem ser gerenciados via sistema de créditos incluídos por plano, com cobrança por excedente

---

## User Interface Design Goals

### Overall UX Vision

Uma interface limpa, moderna e orientada a ação — inspirada em ferramentas como HubSpot e Apollo.io, mas simplificada para o contexto brasileiro. O SDR deve conseguir executar sua rotina diária (verificar leads, iniciar cadências, revisar mensagens geradas pela IA) em no máximo 3 cliques a partir do dashboard principal. A estética deve transmitir profissionalismo e confiança, com foco em dados claros e ações rápidas.

### Key Interaction Paradigms

- **Dashboard-first:** O ponto de entrada é sempre o dashboard com visão consolidada de leads, cadências ativas e métricas
- **Bulk actions:** Importação em massa, enriquecimento em batch, iniciar cadências para múltiplos leads simultaneamente
- **Inline editing:** Editar mensagens geradas pela IA diretamente na tela de cadência, sem navegar para outra página
- **Notificações contextuais:** Alertas sobre respostas de leads, bounces e cadências finalizadas

### Core Screens and Views

1. **Dashboard Principal** — Métricas de performance, leads recentes, cadências ativas, ações pendentes
2. **Importação & Enriquecimento** — Upload CSV/CNPJ, progresso do enriquecimento, resultados em tabela
3. **Lista de Leads** — Tabela com filtros avançados (porte, segmento, localização, status na cadência), busca e bulk actions
4. **Perfil do Lead** — Dados enriquecidos, histórico de interações, cadência ativa, timeline de atividades
5. **Editor de Cadência** — Construtor visual de sequência linear (passos com canal, delay, conteúdo)
6. **Geração de Mensagem IA** — Preview da mensagem gerada, edição inline, seleção de tom/canal
7. **Templates** — Biblioteca de templates de email e WhatsApp com variáveis dinâmicas
8. **Integrações** — Configuração de CRM, Gmail, WhatsApp Business API, Google Calendar
9. **Configurações da Conta** — Gestão de usuários (SDRs + gerente), plano, billing
10. **Relatórios** — Métricas por cadência, por SDR, por período, taxa de conversão

### Accessibility: WCAG AA

Conformidade com WCAG AA — contraste adequado, navegação por teclado, labels em formulários. Essencial para credibilidade em vendas para mid-market.

### Branding

Ainda sem guia de marca definido. Recomendação: paleta moderna com azul/roxo como cor primária (transmite confiança e tecnologia), tipografia sans-serif clean (Inter ou similar), ícones lineares. A ser definido pelo stakeholder.

### Target Device and Platforms: Web Responsive

Web Responsive com prioridade desktop — SDRs trabalham primariamente em desktop/laptop. Layout responsivo para consultas rápidas em mobile (verificar notificações, responder leads urgentes), mas a experiência completa é desktop-first.

---

## Technical Assumptions

### Repository Structure: Monorepo

Monorepo com Next.js — frontend e API routes no mesmo projeto. Supabase como backend-as-a-service elimina a necessidade de um serviço backend separado.

```
enriqueceai/
├── src/
│   ├── app/            # Next.js App Router (pages, layouts)
│   ├── components/     # UI components (shadcn/ui)
│   ├── lib/            # Business logic, utils, API clients
│   ├── services/       # Integrações externas (Lemit, WhatsApp, Gmail, CRM)
│   ├── hooks/          # Custom React hooks
│   └── types/          # TypeScript type definitions
├── supabase/
│   ├── migrations/     # Database migrations
│   ├── functions/      # Edge Functions (webhooks, crons, IA)
│   └── seed/           # Seed data
├── docs/               # PRD, architecture, stories
├── tests/              # Test files
└── public/             # Static assets
```

### Service Architecture

**Monolith com Supabase Edge Functions** — a aplicação principal roda em Next.js (App Router) com server actions e API routes. Processamentos assíncronos (enriquecimento em batch, disparo de cadências, geração de IA) são tratados por Supabase Edge Functions com filas via pg_cron ou Supabase Queues.

**Integrações externas via service layer:**

| Serviço | Propósito | Tipo |
|---------|-----------|------|
| Lemit (ou similar) | Enriquecimento CNPJ | REST API |
| WhatsApp Business API | Envio/recebimento de mensagens | REST API + Webhooks |
| Gmail API | Envio de emails, tracking | OAuth2 + REST API |
| HubSpot/Pipedrive/RD Station | Sync de leads e atividades | REST API + Webhooks |
| Google Calendar API | Agendamento de reuniões | OAuth2 + REST API |
| Claude API | Geração de mensagens com IA | REST API |

### Testing Requirements

- **Unit tests:** Lógica de negócio, services, utils (Vitest)
- **Integration tests:** Fluxos críticos — importação + enriquecimento, criação de cadência, disparo de mensagem (Vitest + Supabase local)
- **E2E:** Apenas para fluxos core do MVP na fase final (Playwright)
- **Coverage goal:** 70% para services/lib, 50% geral no MVP

### Additional Technical Assumptions and Requests

- **Auth:** Supabase Auth com email/password + Google OAuth. Row Level Security (RLS) para isolamento multi-tenant por organização
- **Estado global:** Zustand para estado do cliente, React Query (TanStack Query) para server state e cache
- **UI Components:** shadcn/ui + Tailwind CSS — componentes acessíveis e customizáveis
- **IA Provider:** Claude API (Anthropic) como provider primário para geração de mensagens, com abstração para trocar provider se necessário
- **Filas:** Supabase Edge Functions + pg_cron para jobs agendados (disparo de cadências, batch enrichment)
- **Real-time:** Supabase Realtime para atualizações live no dashboard (status de enriquecimento, respostas de leads)
- **Deploy:** Vercel (Next.js) + Supabase Cloud. CI/CD via GitHub Actions
- **Monitoramento:** Sentry para error tracking, Supabase Dashboard para métricas de banco
- **LGPD:** Consentimento de dados, direito ao esquecimento, logs de acesso a dados pessoais

---

## Epic List

| Epic | Título | Objetivo |
|------|--------|----------|
| **Epic 1** | Foundation & Authentication | Estabelecer infraestrutura do projeto, autenticação, multi-tenancy com RLS, layout base e gestão de usuários (3 SDRs + 1 gerente por conta) |
| **Epic 2** | Lead Import, Enrichment & Dashboard | Importação de leads via CSV/CNPJ, enriquecimento automático via Lemit, dashboard de leads com filtros e métricas — primeira entrega de valor (MVP 1) |
| **Epic 3** | Cadences & Messaging Channels | Construtor de cadências lineares, integração Gmail, WhatsApp Business API, sistema de templates, motor de execução e tracking |
| **Epic 4** | AI-Powered Message Generation | Integração com Claude API para geração de mensagens personalizadas por canal, edição inline, controle de tom |
| **Epic 5** | CRM Integration, Calendar & Reporting | Sincronização bidirecional com CRMs, agendamento via Google Calendar, relatórios de performance e billing |

---

## Epic 1: Foundation & Authentication

**Goal:** Estabelecer a infraestrutura completa do projeto (Next.js + Supabase), implementar autenticação segura, multi-tenancy com RLS e gestão de usuários com o modelo 3 SDRs + 1 gerente. Ao final deste épico, um time pode criar conta, acessar a plataforma e gerenciar seus membros.

### Story 1.1 — Project Setup & Base Configuration

> As a **developer**,
> I want to have the project configured with Next.js, Supabase, Tailwind and shadcn/ui,
> so that we have the technical foundation ready for development.

**Acceptance Criteria:**

1. Projeto Next.js (App Router) inicializado com TypeScript strict mode
2. Supabase configurado (projeto local via CLI + projeto cloud linkado)
3. Tailwind CSS + shadcn/ui instalados e configurados com tema base
4. Estrutura de pastas conforme definido na arquitetura
5. ESLint + Prettier configurados com regras do preset nextjs-react
6. Vitest configurado com um teste placeholder passando
7. Variáveis de ambiente configuradas (`.env.local` + `.env.example`)
8. Sentry configurado para error tracking (básico)
9. `README.md` com instruções de setup local

### Story 1.2 — Authentication & User Registration

> As a **user**,
> I want to sign up and log in with email/password or Google,
> so that I can access the platform securely.

**Acceptance Criteria:**

1. Página de cadastro com formulário (nome, email, senha) usando Supabase Auth
2. Página de login com email/senha
3. Botão "Entrar com Google" funcional (OAuth2 via Supabase)
4. Página de recuperação de senha (forgot password flow)
5. Middleware de proteção de rotas — usuários não autenticados redirecionados para `/login`
6. Sessão persistente com refresh token automático
7. Botão de logout funcional com limpeza de sessão
8. Validação de campos no formulário (email válido, senha mínima 8 caracteres)
9. Testes unitários para validações e testes de integração para o fluxo auth

### Story 1.3 — Multi-tenant Organization System

> As a **newly registered user**,
> I want an organization to be created automatically upon signup,
> so that my team has an isolated and secure space on the platform.

**Acceptance Criteria:**

1. Tabela `organizations` criada no Supabase (id, name, slug, created_at, owner_id)
2. Tabela `organization_members` (org_id, user_id, role, invited_at, accepted_at)
3. Organização criada automaticamente no signup via database trigger ou server action
4. RLS policies implementadas: usuários só acessam dados da própria organização
5. Context provider `OrganizationContext` disponível em toda a aplicação
6. Tela de configuração básica da organização (editar nome)
7. Migration files versionados em `supabase/migrations/`
8. Testes para RLS policies (usuário A não acessa dados da org B)

### Story 1.4 — User Management & Roles

> As a **manager**,
> I want to invite SDRs to my organization and manage their access,
> so that my team can use the platform with appropriate permissions.

**Acceptance Criteria:**

1. Dois roles implementados: `manager` (gerente) e `sdr` (vendedor)
2. O criador da organização recebe automaticamente o role `manager`
3. Tela de gestão de usuários acessível apenas por `manager`
4. Funcionalidade de convite por email (envio de invite link via Supabase)
5. Modelo base: 3 SDRs + 1 gerente incluídos — validação de limite no backend
6. Ao exceder o limite, exibir mensagem informando necessidade de upgrade (placeholder para billing)
7. Lista de membros com status (ativo, pendente, desativado)
8. Manager pode desativar/reativar um membro
9. RLS policies para role-based access (manager vê tudo da org, SDR vê apenas seus dados)
10. Testes para permissões por role

### Story 1.5 — Application Shell & Navigation

> As an **authenticated user**,
> I want to see a professional layout with clear navigation,
> so that I can access all platform features easily.

**Acceptance Criteria:**

1. Layout principal com sidebar colapsável (ícones + labels)
2. Itens de navegação: Dashboard, Leads, Cadências, Templates, Integrações, Configurações
3. Header com nome do usuário, org ativa e menu dropdown (perfil, configurações, logout)
4. Layout responsivo — sidebar vira drawer em mobile
5. Breadcrumbs para navegação contextual
6. Página Dashboard com cards placeholder (métricas vazias, call-to-action para importar leads)
7. Skeleton loaders para transições de página
8. Tema visual aplicado: paleta azul/roxo, tipografia Inter, ícones Lucide
9. Dark mode toggle (opcional mas preparado no tema)
10. Testes de snapshot para componentes do shell

---

## Epic 2: Lead Import, Enrichment & Dashboard

**Goal:** Permitir que o usuário importe leads em massa via CSV/CNPJ, enriqueça automaticamente com dados firmográficos e de contato via Lemit, e visualize tudo em um dashboard inteligente com filtros avançados. Este é o primeiro momento de valor real da plataforma.

### Story 2.1 — Lead Database Schema & Data Model

> As a **developer**,
> I want to have the lead schema structured in Supabase,
> so that all lead features have a solid data foundation.

**Acceptance Criteria:**

1. Tabela `leads` criada (id, org_id, cnpj, status, razao_social, nome_fantasia, endereco, porte, cnae, situacao_cadastral, email, telefone, socios, faturamento_estimado, enrichment_status, enriched_at, created_by, created_at, updated_at)
2. Tabela `lead_imports` (id, org_id, file_name, total_rows, processed_rows, success_count, error_count, status, created_by, created_at)
3. Tabela `lead_import_errors` (id, import_id, row_number, cnpj, error_message)
4. Índices para consultas frequentes: org_id, cnpj, status, enrichment_status, cnae, porte
5. RLS policies: leads isolados por organização
6. Enum types para status e enrichment_status
7. Constraint de unicidade: CNPJ único por organização
8. Migrations versionadas em `supabase/migrations/`
9. Seed data com 20 leads de exemplo para desenvolvimento
10. Testes de RLS e constraints

### Story 2.2 — CSV Import & CNPJ Parsing

> As a **SDR**,
> I want to import a CSV file with prospect CNPJs,
> so that I can register leads in bulk without manual entry.

**Acceptance Criteria:**

1. Página `/leads/import` com drag-and-drop zone para upload de CSV
2. Parser que aceita CSV com coluna CNPJ (detecta automaticamente)
3. Validação de CNPJ (dígitos verificadores) antes de criar o lead
4. Preview dos dados parseados antes da confirmação (primeiras 10 linhas)
5. Indicador de progresso durante o processamento
6. Relatório pós-importação: total importados, duplicados ignorados, CNPJs inválidos
7. Leads criados com status `new` e enrichment_status `pending`
8. Registro na tabela `lead_imports` com estatísticas
9. Erros registrados em `lead_import_errors` com número da linha e motivo
10. Limite de 1.000 leads por importação
11. Testes unitários para parser CSV e validação de CNPJ

### Story 2.3 — CNPJ Enrichment Service

> As a **SDR**,
> I want imported leads to be automatically enriched with company data,
> so that I have complete information without manual research.

**Acceptance Criteria:**

1. Service layer `EnrichmentService` com abstração para múltiplos providers e estratégia em camadas: Camada Básica (CNPJ.ws/ReceitaWS — dados cadastrais gratuitos) e Camada Contato (Lemit — emails, telefones, sócios, faturamento — plano Pro+)
2. Integração com CNPJ.ws (gratuito, rate limited 3 req/min) como provider default e Lemit como provider premium
3. Enriquecimento automático disparado após importação (batch via Edge Function)
4. Rate limiting respeitando limites da API do provider
5. Retry com backoff exponencial (max 3 tentativas)
6. Atualização do lead com dados retornados
7. Status do lead atualizado para `enriched` ou `enrichment_failed`
8. Tempo de enriquecimento individual < 5 segundos (NFR2)
9. Progresso do batch visível em real-time via Supabase Realtime
10. Log de consumo de créditos de API por organização
11. Testes unitários com mock da API Lemit

### Story 2.4 — Lead List with Filters & Bulk Actions

> As a **SDR**,
> I want to view all my leads in a table with advanced filters,
> so that I can quickly find the most relevant prospects.

**Acceptance Criteria:**

1. Página `/leads` com tabela de dados
2. Colunas: nome fantasia, CNPJ, porte, CNAE/segmento, cidade/estado, status, enrichment_status, data de importação
3. Filtros por: porte, segmento/CNAE, estado/cidade, status, enrichment_status
4. Busca textual por razão social, nome fantasia ou CNPJ
5. Ordenação por qualquer coluna
6. Paginação server-side (20 leads por página)
7. Bulk actions: selecionar múltiplos → enriquecer novamente, arquivar, exportar CSV
8. Badge visual para enrichment_status
9. Click na linha navega para o perfil do lead
10. Estado dos filtros persistido na URL (query params)
11. Empty state com CTA para importar primeiro CSV
12. Testes para filtros, paginação e bulk actions

### Story 2.5 — Lead Profile Detail

> As a **SDR**,
> I want to see the complete profile of a lead with all enriched data,
> so that I have full context before starting an approach.

**Acceptance Criteria:**

1. Página `/leads/[id]` com layout em seções organizadas
2. Seção Dados da Empresa: razão social, nome fantasia, CNPJ, endereço, porte, CNAE, situação cadastral, faturamento
3. Seção Contatos: emails, telefones, lista de sócios com CPF parcial (LGPD)
4. Seção Status: status atual, badge de enrichment, datas
5. Seção Timeline de Atividades: placeholder para futuras interações
6. Botão "Re-enriquecer" para forçar novo enriquecimento
7. Botão "Editar" para correção manual
8. Botão "Arquivar" com confirmação
9. Breadcrumb: Leads → [Nome do Lead]
10. Testes para renderização do perfil

### Story 2.6 — Dashboard & Import Metrics

> As a **manager**,
> I want to see a dashboard with lead and import metrics,
> so that I have visibility into my team's prospect base.

**Acceptance Criteria:**

1. Página `/dashboard` substituindo o placeholder do Epic 1
2. Card Total de Leads — contagem por status
3. Card Importações Recentes — últimas 5 com status e taxa de sucesso
4. Card Enriquecimento — taxa de sucesso, leads pendentes, créditos consumidos
5. Card Leads por Porte — gráfico de barras ou donut
6. Card Leads por Estado — distribuição geográfica
7. Filtro de período (7d, 30d, 90d, custom)
8. Dados atualizados em real-time via Supabase Realtime
9. Responsivo — cards reorganizam em grid no mobile
10. Skeleton loaders durante carregamento
11. Testes para cálculos de métricas

---

## Epic 3: Cadences & Messaging Channels

**Goal:** Construir o motor de cadências lineares com suporte a Email (Gmail) e WhatsApp, incluindo sistema de templates com variáveis dinâmicas, engine de execução automatizada e tracking completo de interações.

### Story 3.1 — Cadence & Template Data Model

> As a **developer**,
> I want to have the cadence, steps and templates schema structured,
> so that the cadence engine has a robust data foundation.

**Acceptance Criteria:**

1. Tabela `cadences` (id, org_id, name, description, status, total_steps, created_by, created_at, updated_at)
2. Tabela `cadence_steps` (id, cadence_id, step_order, channel, template_id, delay_days, delay_hours, created_at)
3. Tabela `cadence_enrollments` (id, cadence_id, lead_id, current_step, status, enrolled_at, completed_at, enrolled_by)
4. Tabela `message_templates` (id, org_id, name, channel, subject, body, variables_used[], is_system, created_by, created_at, updated_at)
5. Tabela `interactions` (id, org_id, lead_id, cadence_id, step_id, channel, type, message_content, external_id, metadata, created_at)
6. Índices para consultas frequentes
7. RLS policies: todas as tabelas isoladas por org_id
8. Constraint: lead não pode estar inscrito duas vezes na mesma cadência ativa
9. Migrations versionadas
10. Testes de constraints e RLS

### Story 3.2 — Message Template System

> As a **SDR**,
> I want to create and manage message templates with dynamic variables,
> so that I can reuse personalized messages in my cadences.

**Acceptance Criteria:**

1. Página `/templates` com lista organizada por canal
2. Editor de template com campos: nome, canal, assunto (email), corpo
3. Sistema de variáveis dinâmicas com sintaxe `{{variavel}}`
4. Inserção de variável via dropdown/autocomplete
5. Preview da mensagem renderizada com dados de um lead real
6. CRUD completo: criar, editar, duplicar, deletar
7. Templates de sistema pré-criados: 3 para email, 3 para WhatsApp
8. Validação: email requer subject, WhatsApp respeita limite de caracteres
9. Filtro e busca por nome/canal
10. Testes para renderização de variáveis

### Story 3.3 — Cadence Builder UI

> As a **SDR**,
> I want to create cadences with a visual sequence of steps,
> so that I can easily define the contact flow with my leads.

**Acceptance Criteria:**

1. Página `/cadences` com lista de cadências
2. Página `/cadences/new` com construtor visual linear
3. Cada passo exibe: número, ícone do canal, template, delay
4. Adicionar passo: selecionar canal → template → delay
5. Reordenar passos via drag-and-drop
6. Remover passo com confirmação
7. Preview visual da timeline completa
8. Salvar como draft ou ativar imediatamente
9. Editar cadência existente (somente draft ou pausada)
10. Mínimo de 2 passos para ativar
11. Inscrever leads na cadência (individual ou batch)
12. Testes para criação, reordenação e validações

### Story 3.4 — Gmail Integration (OAuth2)

> As a **SDR**,
> I want to connect my Gmail account to the platform,
> so that cadence emails are sent from my own address.

**Acceptance Criteria:**

1. Página `/settings/integrations` com card "Gmail" e botão "Conectar"
2. Fluxo OAuth2 completo
3. Tokens armazenados criptografados no Supabase
4. Refresh automático do token
5. Service `EmailService` com método `sendEmail()`
6. Suporte a HTML no corpo do email
7. Tracking de abertura via pixel invisível
8. Tracking de cliques via redirect de links
9. Status da conexão visível
10. Botão "Desconectar" com confirmação
11. Tratamento de bounces via Gmail API
12. Testes unitários com mock da Gmail API

### Story 3.5 — WhatsApp Business API Integration

> As a **SDR**,
> I want to connect WhatsApp Business to the platform,
> so that cadence messages are sent via WhatsApp automatically.

**Acceptance Criteria:**

1. Card "WhatsApp Business" na página de integrações
2. Configuração via Meta Cloud API: Phone Number ID, Business Account ID, Access Token
3. Tokens armazenados criptografados
4. Service `WhatsAppService` com método `sendMessage()`
5. Suporte a mensagens de texto livre e template messages
6. Webhook endpoint para status de entrega
7. Atualização automática de `interactions` via webhook
8. Validação de número de telefone (formato brasileiro)
9. Rate limits com queue e retry
10. Status da conexão visível
11. Testes unitários com mock da Meta API

### Story 3.6 — Cadence Execution Engine & Interaction Tracking

> As a **SDR**,
> I want cadences to automatically execute steps at the right time,
> so that I don't need to remember to send each message manually.

**Acceptance Criteria:**

1. Edge Function `execute-cadence-steps` via pg_cron a cada 15 minutos
2. Busca enrollments ativos onde o delay foi atingido
3. Renderiza template com variáveis do lead e despacha via canal correto
4. Registra interação na tabela `interactions`
5. Avança `current_step` após envio bem-sucedido
6. Marca enrollment como `completed` quando todos os passos executados
7. Marca como `replied` se resposta detectada
8. Pausa automática se bounce ou falha
9. Timeline de atividades no perfil do lead (substitui placeholder do Epic 2)
10. Métricas por cadência: leads inscritos, em progresso, completados, responderam, bounce rate
11. Logs de execução para debugging
12. Testes para scheduling, renderização e estado do enrollment

---

## Epic 4: AI-Powered Message Generation

**Goal:** Integrar a Claude API para geração de mensagens personalizadas por canal, utilizando o perfil enriquecido do lead como contexto. O SDR pode gerar, revisar e editar mensagens com IA em segundos.

### Story 4.1 — AI Service Layer & Prompt Engineering

> As a **developer**,
> I want to have an AI service layer with optimized prompts for sales engagement,
> so that message generation is consistent, high-quality and easy to evolve.

**Acceptance Criteria:**

1. Service `AIService` com abstração de provider (Claude API como default)
2. Client Claude API via Edge Function (key não exposta no client)
3. Endpoint `/api/ai/generate-message`
4. Prompt template para email otimizado para outbound B2B
5. Prompt template para WhatsApp (tom direto, limite de caracteres)
6. 4 opções de tom: profissional, consultivo, direto, amigável
7. Context injection com dados enriquecidos do lead
8. Validação e sanitização de output
9. Rate limiting por organização (tabela `ai_usage`)
10. Latência de geração < 3 segundos
11. Testes com mock da Claude API

### Story 4.2 — Lead Message Generation UI

> As a **SDR**,
> I want to generate a personalized message with AI from a lead's profile,
> so that I create relevant approaches in seconds.

**Acceptance Criteria:**

1. Botão "Gerar mensagem com IA" no perfil do lead
2. Modal de geração: seleção de canal, tom, contexto adicional
3. Botão "Gerar" com loading skeleton
4. Mensagem gerada exibida em preview formatado
5. Edição inline da mensagem gerada
6. Botão "Regenerar" para nova versão
7. Botão "Salvar como template"
8. Botão "Copiar" para clipboard
9. Botão "Usar em cadência"
10. Contador de uso de IA visível
11. Testes para fluxo de geração e edição

### Story 4.3 — Cadence AI Personalization (Batch)

> As a **SDR**,
> I want AI to automatically personalize cadence messages for each enrolled lead,
> so that each prospect receives a unique message even from the same base template.

**Acceptance Criteria:**

1. Toggle "Personalizar com IA" em cada step da cadência
2. Execution engine chama AIService antes de enviar quando ativado
3. IA gera versão personalizada mantendo estrutura e CTA do template
4. Mensagem salva com `ai_generated: true` e `original_template_id`
5. Preview de personalização para 3 leads de amostra
6. Fallback para template original se geração falhar
7. Badge visual indicando steps com IA ativada
8. Métricas comparativas (placeholder): taxa resposta IA vs sem IA
9. Respeita rate limit diário — fallback automático se excedido
10. Testes para fluxo batch e fallback

---

## Epic 5: CRM Integration, Calendar & Reporting

**Goal:** Fechar o ciclo completo de vendas com sincronização bidirecional de CRMs, agendamento de reuniões via Google Calendar, relatórios de performance e gestão de planos/billing.

### Story 5.1 — CRM Integration Framework & HubSpot

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

### Story 5.2 — Pipedrive & RD Station CRM Adapters

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

### Story 5.3 — Google Calendar Integration

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

### Story 5.4 — Reporting & Analytics

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

### Story 5.5 — Billing & Plan Management

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

---

## Checklist Results Report

### Executive Summary

- **Overall PRD Completeness:** 88%
- **MVP Scope Appropriateness:** Just Right
- **Readiness for Architecture Phase:** Ready
- **Most Critical Gaps:** Falta de user research formal, métricas de sucesso sem baseline, competitive analysis ausente

### Category Statuses

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| 1. Problem Definition & Context | PARTIAL (80%) | Falta quantificação do impacto e competitive analysis formal |
| 2. MVP Scope Definition | PASS (92%) | Scope bem definido com roadmap claro de fases |
| 3. User Experience Requirements | PASS (90%) | 10 core screens mapeadas, WCAG AA definido |
| 4. Functional Requirements | PASS (95%) | 13 FRs cobrindo todo o escopo, testáveis |
| 5. Non-Functional Requirements | PASS (90%) | 8 NFRs com métricas concretas, LGPD incluída |
| 6. Epic & Story Structure | PASS (95%) | 5 épicos, 25 stories sequenciais com ACs detalhados |
| 7. Technical Guidance | PASS (92%) | Stack definida, arquitetura clara, integrações mapeadas |
| 8. Cross-Functional Requirements | PARTIAL (78%) | Integrações bem documentadas, data retention policies ausentes |
| 9. Clarity & Communication | PASS (90%) | Documento bem estruturado, terminologia consistente |

### Top Issues by Priority

**HIGH:**
- Sem competitive analysis formal (Meetime, Apollo, Outreach) — recomenda-se delegar a @analyst
- Métricas de sucesso (KPIs) não definidas com baseline e timeframe
- Data retention policies para LGPD não detalhadas

**MEDIUM:**
- Sem user personas formais (temos perfil genérico SDR/gerente)
- Falta de diagramas visuais (fluxos, ER diagram)
- Branding não definido

**LOW:**
- Sem stakeholder map formal
- Sem timeline estimada por épico
- Sem seção formal de "Out of Scope"

### MVP Scope Assessment

- **Scope adequado:** 5 épicos com 25 stories é ambicioso mas viável para MVP
- **Poderia cortar para MVP mínimo:** Epic 5 (CRM + Calendar + Reporting) poderia ser pós-MVP
- **Nada essencial faltando:** Todos os FRs mapeiam para stories
- **Complexidade:** Stories 2.3 (enrichment), 3.6 (execution engine) e 4.3 (batch AI) são as mais complexas

### Technical Readiness

- **Stack clara:** Next.js + Supabase + shadcn/ui, sem ambiguidade
- **Riscos técnicos:** WhatsApp Business API tem processo de aprovação da Meta; Lemit API availability; custos de Claude API em escala
- **Áreas para architect:** Detalhamento de filas/cron, estratégia de caching, ER diagram formal

### Final Decision

**READY FOR ARCHITECT** — O PRD está completo e bem estruturado com 5 épicos sequenciais, 25 stories com acceptance criteria detalhados e stack técnica definida. Os gaps identificados (competitive analysis, KPIs, data retention) são melhorias que podem ser endereçadas em paralelo sem bloquear o início da fase de arquitetura.

---

## Next Steps

### UX Expert Prompt

> @ux-design-expert — Revise o PRD em `docs/prd.md` para o projeto EnriqueceAI. Foco em: (1) validar as 10 core screens propostas e propor wireframes low-fidelity, (2) definir o design system base (paleta azul/roxo, tipografia Inter, ícones Lucide, componentes shadcn/ui), (3) mapear os user flows críticos: importação de leads, criação de cadência, geração de mensagem com IA, (4) garantir WCAG AA compliance. Output: `docs/architecture/frontend-spec.md`.

### Architect Prompt

> @architect — Revise o PRD em `docs/prd.md` para o projeto EnriqueceAI. Stack: Next.js (App Router) + Supabase + shadcn/ui + Tailwind. Foco em: (1) criar o documento de arquitetura com ER diagram, (2) detalhar a estratégia de multi-tenancy com RLS, (3) definir a arquitetura de integrações (Lemit, WhatsApp Business API, Gmail API, CRMs, Claude API), (4) planejar a estratégia de filas e jobs assíncronos (Edge Functions + pg_cron), (5) definir padrões de código e estrutura de projeto. Output: `docs/architecture/architecture.md`.

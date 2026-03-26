# Epic 4: Production Readiness

**Status:** Draft
**Created:** 2026-03-03
**Author:** @pm (Morgan)
**Priority:** CRITICAL
**Total Stories:** 7 (2 Waves)

---

## Epic Goal

Preparar o EnriqueceAI para lançamento com clientes reais, garantindo que planos existam no banco, trials expirem corretamente, features sejam bloqueadas por plano, limites sejam enforced, onboarding inclua checkout, e o sistema de billing esteja completo e seguro.

## Existing System Context

- **Tech Stack:** Next.js 16 (App Router), React 19, Supabase (PostgreSQL 17 + Auth + Realtime), Tailwind CSS v4 + shadcn/ui, TypeScript strict, Stripe
- **Current State:** 29 stories Done (Epics 1-3 + 3.19). App funcional com auth, leads, cadências, templates, atividades, dashboard, billing básico, integrações CRM/Gmail/WhatsApp/Calendar, AI generation, fit score, statistics, encryption at rest.
- **Pattern:** Feature modules verticais (`src/features/{name}/`), Server Actions com `ActionResult<T>`, RLS multi-tenant

## Critical Gaps Identified

| Gap | Impact | Current State |
|-----|--------|---------------|
| Tabela `plans` vazia | BLOCKER | Trigger `handle_new_user()` falha silenciosamente sem plano 'starter' |
| Trial nunca expira | CRITICAL | Status fica 'trialing' eternamente, acesso gratuito ilimitado |
| `max_leads` não enforced | HIGH | Usuários podem criar leads infinitos independente do plano |
| Features não bloqueadas por plano | HIGH | CRM/Calendar acessíveis mesmo no Starter |
| Onboarding sem checkout | HIGH | Usuários não selecionam plano nem pagam |
| Senha temporária exposta | MEDIUM | `InviteMemberDialog` mostra senha em texto no UI |
| Sem usage dashboard | MEDIUM | Manager não vê consumo vs limites em tempo real |

## Quality Gate Standard

Todas as stories seguem:
- **Gate:** `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` passando
- **Security:** Nenhuma credencial exposta, Stripe webhooks validados
- **RLS:** Todas as novas tabelas com policies de isolamento por org

---

## Wave Structure

| Wave | Foco | Stories | Points |
|------|------|---------|--------|
| **Wave 1** | Foundation — Must-Have para Launch | 4.1 — 4.4 | 23 |
| **Wave 2** | Polish — Retenção e UX | 4.5 — 4.7 | 11 |
| | | **Total** | **34** |

---

## Wave 1: Foundation — Must-Have para Launch

### Story 4.1: Plans Seed + Trial Lifecycle

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Seed dos 3 planos no banco, enforcement de expiração de trial, e banner de trial no app.

**Scope IN:**
- Migration seed: inserir 3 planos (Starter R$149, Pro R$349, Enterprise R$699) na tabela `plans`
- Cron job (pg_cron ou Supabase cron) para expirar trials com `current_period_end < now()`
- Trial expirado: status 'trialing' → 'canceled' automaticamente
- Banner de trial no app header: "Seu trial expira em X dias" com CTA upgrade
- Coluna `trial_ends_at` em `subscriptions` (ou usar `current_period_end` existente)
- Página de "Trial Expirado" bloqueando acesso ao app com CTA para upgrade

**Scope OUT:**
- Grace period pós-trial (futuro)
- Notificação por email de trial expirando (futuro)
- Planos customizados

**Acceptance Criteria:**
- [ ] Migration insere 3 planos com todos os limites corretos (max_leads, max_ai_per_day, max_whatsapp_per_month, included_users, features JSONB)
- [ ] Novo signup cria subscription 'trialing' vinculada ao plano 'starter' (já existe no trigger, validar que funciona com seed)
- [ ] Cron executa diariamente e muda trials expirados para 'canceled'
- [ ] Banner de trial visível no app header com countdown (apenas para 'trialing')
- [ ] Quando trial expira, usuário é redirecionado para página de upgrade
- [ ] Testes unitários para lógica de expiração

**Notas técnicas:**
- O trigger `handle_new_user()` já tenta buscar plano 'starter' — com seed, passa a funcionar
- Cron pode ser Edge Function scheduled ou `pg_cron` extension
- Banner reutiliza `SubscriptionRow.current_period_end` para cálculo de dias restantes

---

### Story 4.2: Feature Gating & Limit Enforcement

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Bloquear features por plano, enforcer limite de leads, e exibir upgrade prompts contextuais.

**Scope IN:**
- Guard `requireFeature('crm')` para páginas de integração CRM
- Guard `requireFeature('calendar')` para integração Calendar
- Guard de enrichment level (basic vs lemit vs full)
- Enforce `max_leads` no `create-lead.ts` e `import-leads.ts`
- Componente `UpgradePrompt` reutilizável (ícone lock + texto + botão upgrade)
- Upgrade prompt no lugar do conteúdo quando feature bloqueada
- Middleware ou layout guard para redirecionar se subscription cancelada/expirada

**Scope OUT:**
- Granularidade por feature individual (apenas CRM, Calendar, enrichment)
- Plano Enterprise com features exclusivas
- Feature toggles administrativos

**Acceptance Criteria:**
- [ ] Usuário no plano Starter não consegue acessar página de CRM (vê `UpgradePrompt`)
- [ ] Usuário no plano Starter não consegue acessar página de Calendar (vê `UpgradePrompt`)
- [ ] Criação de lead retorna erro `LEAD_LIMIT_REACHED` quando `max_leads` atingido
- [ ] Import CSV retorna erro com contagem de leads que excederia o limite
- [ ] `UpgradePrompt` mostra: ícone lock, nome da feature, plano necessário, botão "Fazer upgrade"
- [ ] Subscription com status 'canceled' redireciona para página de upgrade em todas as rotas do app
- [ ] Testes para guards de feature e limite de leads

**Notas técnicas:**
- `checkFeature()` já existe em `feature-flags.ts` — reutilizar
- Guard pode ser Server Component que lê subscription + plan no RSC
- `UpgradePrompt` aceita props: `featureName`, `requiredPlan`, `currentPlan`

---

### Story 4.3: Onboarding 2.0 com Checkout

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 8

**Objetivo:** Expandir onboarding de 3 para 6 steps, incluindo seleção de plano e checkout Stripe.

**Scope IN:**
- Step 1: Nome da empresa (existente, manter)
- Step 2: Seleção de plano (3 cards comparativos, incluindo free trial)
- Step 3: Checkout Stripe (redirect para Stripe Checkout, retorno com success/cancel)
- Step 4: Conectar Gmail (OAuth, com skip)
- Step 5: Convidar equipe (emails, com skip)
- Step 6: Pronto! (checklist do que foi configurado)
- Skip para steps opcionais (Gmail, equipe)
- Progress bar atualizado para 6 steps
- Retomar onboarding se interrompido (salvar step atual)

**Scope OUT:**
- Conectar CRM durante onboarding
- Conectar WhatsApp durante onboarding
- Upload de leads CSV durante onboarding
- Feature tour / guided walkthrough

**Acceptance Criteria:**
- [ ] Onboarding tem 6 steps com progress bar
- [ ] Step 2 mostra 3 planos com preços e features (reutilizar `PlanComparison`)
- [ ] Step 3 redireciona para Stripe Checkout, retorna ao onboarding após pagamento
- [ ] Step 3 permite "Continuar com trial gratuito" (skip checkout)
- [ ] Step 4 permite conectar Gmail via OAuth ou skip
- [ ] Step 5 permite convidar membros por email (reutilizar lógica de `invite-member.ts`)
- [ ] Step 6 mostra resumo do que foi configurado com checkmarks
- [ ] Se onboarding interrompido, retoma do último step ao voltar
- [ ] Testes para fluxo de onboarding e navegação entre steps

**Notas técnicas:**
- Salvar progresso em `organizations.onboarding_step` (nova coluna, nullable int)
- Reutilizar `PlanComparison` component do billing
- Reutilizar `createCheckoutSession` action com return_url para onboarding
- Gmail OAuth: reutilizar `handleGmailCallback` existente
- Invite: reutilizar `inviteMember` action existente

---

### Story 4.4: Usage Dashboard & Alerts

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Dashboard de consumo para managers com barras de progresso, alertas e histórico.

**Scope IN:**
- Página `/settings/usage` (ou seção expandida em `/settings/billing`)
- Cards de uso: Leads (atual/max), AI (hoje/max diário), WhatsApp (mês/max mensal), Membros (atual/incluídos)
- Barras de progresso com cores: verde (<60%), amarelo (60-80%), vermelho (>80%)
- Alertas in-app quando 80% de qualquer limite atingido (notificação para managers)
- Alerta de AI diário atingido (já existe parcialmente)
- Alerta de leads próximo ao limite
- Histórico de uso AI por dia (últimos 30 dias) — gráfico de linha simples

**Scope OUT:**
- Alertas por email
- Previsão de uso (predictive)
- Detalhamento por SDR individual
- Export de relatório de uso

**Acceptance Criteria:**
- [ ] Página de uso acessível por managers em `/settings/billing` (tab ou seção)
- [ ] 4 cards de uso com barras de progresso coloridas
- [ ] Barras mudam de cor conforme threshold (verde → amarelo → vermelho)
- [ ] Notificação in-app quando leads atingem 80% do limite
- [ ] Notificação in-app quando AI diário atinge 80% do limite
- [ ] Gráfico de uso AI dos últimos 30 dias
- [ ] Apenas managers veem a página de uso
- [ ] Testes para cálculos de threshold e componentes de barra

**Notas técnicas:**
- Reutilizar `calculateUsageLimits()` e `isNearLimit()` de `feature-flags.ts`
- WhatsApp alert já existe em `whatsapp-credit.service.ts` — replicar padrão para AI e leads
- Histórico AI: query `ai_usage` dos últimos 30 dias
- Notificações via `createNotificationsForOrgMembers()` existente

---

## Wave 2: Polish — Retenção e UX

### Story 4.5: Upgrade & Downgrade Flows

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 5

**Objetivo:** Fluxos completos de upgrade, downgrade e reativação com confirmações claras.

**Scope IN:**
- Modal de confirmação de upgrade com diff de features (o que ganha)
- Modal de confirmação de downgrade com diff de features (o que perde)
- Aviso de features que serão desativadas no downgrade (ex: CRM desconectado se ir para Starter)
- Página "Subscription Cancelada" com opção de reativar
- Stripe Customer Portal integration melhorada
- Toast de sucesso após upgrade/downgrade completado

**Scope OUT:**
- Proration (Stripe faz automaticamente)
- Coupon/discount codes
- Annual billing

**Acceptance Criteria:**
- [ ] Modal de upgrade mostra features que serão desbloqueadas
- [ ] Modal de downgrade mostra features que serão perdidas com aviso
- [ ] Downgrade verifica se org está usando features do plano superior (alerta)
- [ ] Página de subscription cancelada com CTA "Reativar" → Stripe Checkout
- [ ] Toast de sucesso após mudança de plano
- [ ] Testes para modais de confirmação

---

### Story 4.6: Invite System Hardening

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 3

**Objetivo:** Remover exposição de senha temporária e melhorar gestão de convites.

**Scope IN:**
- Substituir senha temporária por magic link via Supabase Auth
- Email de convite com nome da org e link de acesso
- Lista de convites pendentes na página de usuários
- Ações: reenviar convite, revogar convite
- Expiração de convite (7 dias)

**Scope OUT:**
- Email template customizado com branding
- Convite via link compartilhável
- Bulk invite (CSV de emails)

**Acceptance Criteria:**
- [ ] Convite não mostra senha temporária no UI
- [ ] Membro convidado recebe email com magic link
- [ ] Lista de convites pendentes visível na página de usuários
- [ ] Manager pode reenviar convite pendente
- [ ] Manager pode revogar convite pendente
- [ ] Convites expiram após 7 dias (status → 'expired')
- [ ] Testes para fluxo de convite e expiração

**Notas técnicas:**
- Supabase Auth `admin.inviteUserByEmail()` já envia email — garantir que não mostra senha
- Adicionar coluna `invited_expires_at` em `organization_members`
- Cron job para expirar convites (pode ser o mesmo da trial)

---

### Story 4.7: Billing Polish

**Executor:** @dev | **Quality Gate:** @architect | **Points:** 3

**Objetivo:** Polir página de billing com histórico de faturas, método de pagamento e estados de sucesso.

**Scope IN:**
- Seção de histórico de faturas (via Stripe API `invoices.list`)
- Exibição do método de pagamento atual (últimos 4 dígitos do cartão)
- Toast/banner de sucesso após checkout (`?success=true` na URL)
- Toast/banner de cancelamento (`?canceled=true` na URL)
- Link para Stripe Customer Portal para gerenciar pagamento
- Empty state para billing quando em trial (sem faturas)

**Scope OUT:**
- Customização de método de pagamento fora do Stripe Portal
- Boleto/PIX como métodos de pagamento
- Nota fiscal automática

**Acceptance Criteria:**
- [ ] Seção "Histórico de Faturas" mostra últimas 10 faturas (data, valor, status, PDF link)
- [ ] Método de pagamento atual visível (tipo + últimos 4 dígitos)
- [ ] Banner verde de sucesso quando retorna de checkout com `?success=true`
- [ ] Banner amarelo quando retorna com `?canceled=true`
- [ ] Empty state adequado para orgs em trial
- [ ] Link funcional para Stripe Customer Portal
- [ ] Testes para componentes de billing

**Notas técnicas:**
- `stripe.invoices.list({ customer: stripe_customer_id, limit: 10 })`
- `stripe.customers.retrieve(id)` para método de pagamento default
- Stripe Portal já existe em `create-portal.ts` — apenas melhorar o link e UX

---

## Database Migration Summary

### Novas Tabelas

Nenhuma nova tabela necessária — todas as tabelas já existem.

### Colunas Novas em Tabelas Existentes

| Tabela | Coluna | Story | Descrição |
|--------|--------|-------|-----------|
| `organizations` | `onboarding_step` | 4.3 | Step atual do onboarding (nullable int, NULL = concluído) |
| `organization_members` | `invited_expires_at` | 4.6 | Data de expiração do convite |

### Seed Data

| Tabela | Story | Descrição |
|--------|-------|-----------|
| `plans` | 4.1 | 3 planos: starter, pro, enterprise com todos os limites |

---

## Dependency Graph

```
Wave 1:
  4.1 (Plans Seed + Trial) ──────────────────────┐
  4.2 (Feature Gating) ─── depende de 4.1 ───────│
  4.3 (Onboarding 2.0) ─── depende de 4.1 ───────│── Wave 1
  4.4 (Usage Dashboard) ── depende de 4.1 ───────│

Wave 2: (depende de Wave 1 concluída)
  4.5 (Upgrade/Downgrade) ── depende de 4.2 ─────│
  4.6 (Invite Hardening) ── independente ─────────│── Wave 2
  4.7 (Billing Polish) ──── depende de 4.1 ──────│
```

**Story 4.1 é a fundação** — todas as outras dependem dos planos existirem no banco.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stripe Checkout redireciona fora do app durante onboarding | Alto | Return URL configurado para `/onboarding?step=3&success=true` |
| Trial expiry pode bloquear usuários sem aviso | Alto | Banner countdown + notificação 7 dias antes |
| Feature gating pode quebrar fluxos existentes | Médio | Guard retorna `UpgradePrompt` em vez de 404 |
| Plans seed em produção pode conflitar com dados existentes | Médio | Usar `INSERT ... ON CONFLICT DO NOTHING` |
| Onboarding step tracking pode perder estado | Baixo | Salvar em DB, não em localStorage |

## Rollback Plan

- Cada story é independente exceto dependência em 4.1
- Plans seed é idempotente (ON CONFLICT DO NOTHING)
- Feature gates degradam gracefully (sem gate = acesso liberado)
- Onboarding fallback: 3 steps originais se nova versão falhar
- Trial enforcement pode ser desabilitado removendo cron job

---

## Definition of Done

- [ ] 3 planos seedados no banco (produção)
- [ ] Trials expiram automaticamente após 30 dias
- [ ] Features bloqueadas por plano (CRM, Calendar, enrichment)
- [ ] Limite de leads enforced
- [ ] Onboarding inclui seleção de plano e checkout
- [ ] Usage dashboard funcional para managers
- [ ] Convites sem exposição de senha
- [ ] Billing page com faturas e método de pagamento
- [ ] Lint + typecheck + tests + build passando
- [ ] Sem regressão em funcionalidades existentes

---

## Change Log

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-03-03 | @pm (Morgan) | Epic criado — 7 stories, 2 waves, 34 points |

---

## Story Manager Handoff

"Please develop detailed user stories for this epic. Key considerations:

- This is a production hardening epic — focus on security, billing, and access control
- Stripe integration is already working (checkout + webhooks) — extend, don't recreate
- Feature flags service exists (`feature-flags.ts`) — extend with UI enforcement
- Onboarding exists (3 steps) — expand to 6 steps with checkout
- All existing patterns must be maintained (Server Actions, ActionResult, RLS)
- Trial lifecycle is critical path — users must not get permanent free access
- Total: 7 stories, 34 story points, 2 waves

The epic should ensure EnriqueceAI is ready for real paying customers while maintaining system integrity."

— Morgan, preparando o lançamento

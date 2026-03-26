# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EnriqueceAI** is a B2B Sales Engagement platform for Brazilian sales teams. It manages leads (identified by CNPJ), multi-channel outreach cadences (email + WhatsApp), AI-powered message generation, CRM integrations, and billing via Stripe.

## Tech Stack

- **Framework:** Next.js 16+ (App Router, React 19)
- **Language:** TypeScript (strict mode, `noUncheckedIndexedAccess` enabled — array indexing returns `T | undefined`)
- **BaaS:** Supabase (Auth, PostgreSQL 17, Realtime, Edge Functions)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Testing:** Vitest + Testing Library + Playwright (E2E)
- **Package Manager:** pnpm (required, v10+)
- **Node:** >= 22.0.0
- **AI:** Claude Sonnet via direct Anthropic API calls
- **Monitoring:** Sentry (client + server + edge)

## Commands

```bash
# Development
pnpm dev                          # Start Next.js dev server
pnpm build                        # Production build
pnpm typecheck                    # TypeScript type checking (tsc --noEmit)
pnpm lint                         # ESLint (src/ only)
pnpm lint:fix                     # ESLint autofix
pnpm format                       # Prettier format
pnpm format:check                 # Prettier check

# Testing
pnpm test                         # Vitest watch mode
pnpm test:run                     # Vitest single run (CI)
pnpm exec vitest run path/to/test # Run specific test file/dir
pnpm test:coverage                # Vitest with V8 coverage
pnpm test:e2e                     # Playwright E2E tests
pnpm test:e2e:ui                  # Playwright with UI

# Supabase (local)
npx supabase start                # Start local Supabase
npx supabase stop                 # Stop local Supabase
npx supabase db reset             # Reset DB + run all migrations + seed
npx supabase migration new <name> # Create new migration file
```

## Architecture

### Source Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (app)/              # Authenticated routes (sidebar layout)
│   ├── (auth)/             # Unauthenticated routes (centered card layout)
│   ├── api/                # Webhooks, OAuth callbacks, cron, tracking, AI generation
│   └── onboarding/         # Org setup wizard
├── features/               # Vertical slice feature modules
│   ├── activities/         # SDR activity queue (Meetime-style)
│   ├── ai/                 # Claude Sonnet message generation
│   ├── auth/               # Auth, org management, roles, onboarding
│   ├── billing/            # Stripe checkout/portal, plan limits
│   ├── cadences/           # Multi-channel outreach sequences
│   ├── calls/              # Phone call tracking and management
│   ├── dashboard/          # KPI metrics
│   ├── integrations/       # CRM (HubSpot/Pipedrive/RD Station), Gmail, Calendar, WhatsApp
│   ├── leads/              # CNPJ-based B2B leads, CSV import, enrichment
│   ├── notifications/      # Realtime in-app notifications
│   ├── reports/            # Cadence/SDR performance reports
│   ├── settings-prospecting/ # Prospecting config (daily goals, loss reasons, fit score, blacklist, ABM)
│   ├── statistics/         # Activity, conversion, calls, and team analytics
│   └── templates/          # Email/WhatsApp message templates
├── shared/                 # Cross-feature UI components, schemas, types
│   └── components/ui/      # shadcn/ui Radix-based primitives
├── lib/                    # Infrastructure (supabase clients, auth guards, security)
└── config/                 # Zod-validated env schema
```

### Feature Module Convention

Each feature follows this pattern (not all features have every file):

```
features/{name}/
├── index.ts                # Barrel export (public API)
├── {name}.contract.ts      # TypeScript interface contracts (when applicable)
├── types/index.ts          # Domain types
├── schemas/                # Zod validation schemas + colocated tests
├── actions/                # Server Actions ('use server')
├── services/               # Business logic
├── components/             # React components
└── hooks/                  # Client-side React hooks
```

### Server Actions Pattern

All mutations use Next.js Server Actions (not API routes). Every action returns `ActionResult<T>`:

```typescript
type ActionResult<T> = { success: true; data: T } | { success: false; error: string; code?: string };
```

Standard action structure: `requireAuth()` → Zod validation → Supabase query → return `ActionResult`. API routes are reserved for webhooks, OAuth callbacks, cron triggers, tracking pixels, and AI generation endpoints.

### Supabase Client Tiers

| Client | File | Usage |
|--------|------|-------|
| `createClient()` | `lib/supabase/client.ts` | Browser — cookie-based session |
| `createServerSupabaseClient()` | `lib/supabase/server.ts` | RSCs, Server Actions, Route Handlers |
| `createServiceRoleClient()` | `lib/supabase/service.ts` | Bypasses RLS — webhooks, cron, notifications |
| `createAdminSupabaseClient()` | `lib/supabase/admin.ts` | Service role for reading `auth.users` data |

### Multi-Tenancy & Auth

- **Tenant isolation via RLS**: Every table has org-scoped policies. `user_org_id()` and `is_manager()` are the PostgreSQL RLS primitives.
- **Two roles**: `manager` and `sdr`. Manager-only pages use `requireManager()` guard.
- **Middleware** (`src/middleware.ts`): CSRF origin check, session refresh, auth redirects, onboarding gate.
- **Auth guards**: `requireAuth()` and `requireManager()` in `lib/auth/`.

### Realtime

`OrganizationProvider` and `NotificationProvider` subscribe to Supabase `postgres_changes` for live updates. Used in the `(app)` layout.

### Path Aliases

- `@/*` → `./src/*`
- `@tests/*` → `./tests/*`

## Testing

- **Unit tests**: Colocated with source in `src/features/**/*.test.{ts,tsx}`
- **Test infra**: `tests/setup.ts` (jest-dom matchers), `tests/mocks/supabase.ts` (vi.fn() mocks), `tests/mocks/server.ts` (MSW)
- **RLS integration tests**: `tests/integration/rls-policies.test.ts` — auto-skipped when Supabase isn't running
- **E2E tests**: `e2e/*.spec.ts` — Playwright

### Supabase Mocking Pattern

```typescript
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
// Then in tests: vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase);
```

## Environment Variables

Core vars validated by Zod in `src/config/env.ts`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (required)
- `SUPABASE_SERVICE_ROLE_KEY` (for webhooks/cron)
- `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000`)
- `ANTHROPIC_API_KEY` (AI message generation)
- CRM OAuth pairs: `HUBSPOT_*`, `PIPEDRIVE_*`, `RDSTATION_*`, `GCAL_*`
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

Additional vars used via `process.env` (not in Zod schema):
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET`

## ESLint

- Extends `eslint-config-next` + `eslint-config-prettier`
- `no-console`: warn (allows `console.warn` and `console.error`)
- Unused vars with `_` prefix are allowed (rule severity: error)
- Ignores: `.next/`, `node_modules/`, `supabase/functions/`, `.aios-core/`

## Database

Migrations in `supabase/migrations/`. Rollbacks in `supabase/rollbacks/`. Edge functions in `supabase/functions/` (Deno runtime — excluded from TypeScript compilation).

Key tables: `organizations`, `organization_members`, `leads`, `cadences`, `cadence_steps`, `cadence_enrollments`, `interactions`, `message_templates`, `subscriptions`, `plans`, `ai_usage`, `whatsapp_credits`, `notifications`.

---

# Synkra AIOS Development Rules for Claude Code

You are working with Synkra AIOS, an AI-Orchestrated System for Full Stack Development.

<!-- AIOS-MANAGED-START: core-framework -->
## Core Framework Understanding

Synkra AIOS is a meta-framework that orchestrates AI agents to handle complex development workflows. Always recognize and work within this architecture.
<!-- AIOS-MANAGED-END: core-framework -->

<!-- AIOS-MANAGED-START: agent-system -->
## Agent System

### Agent Activation
- Agents are activated with @agent-name syntax: @dev, @qa, @architect, @pm, @po, @sm, @analyst
- The master agent is activated with @aios-master
- Agent commands use the * prefix: *help, *create-story, *task, *exit

### Agent Context
When an agent is active:
- Follow that agent's specific persona and expertise
- Use the agent's designated workflow patterns
- Maintain the agent's perspective throughout the interaction
<!-- AIOS-MANAGED-END: agent-system -->

## Development Methodology

### Story-Driven Development
1. **Work from stories** - All development starts with a story in `docs/stories/`
2. **Update progress** - Mark checkboxes as tasks complete: [ ] → [x]
3. **Track changes** - Maintain the File List section in the story
4. **Follow criteria** - Implement exactly what the acceptance criteria specify

### Code Standards
- Follow existing patterns in the codebase
- Use the feature module convention (contract → types → schemas → actions → services → components)
- Use TypeScript strict mode — handle `T | undefined` from indexed access

### Testing Requirements
- Run all tests before marking tasks complete
- Ensure linting passes: `pnpm lint`
- Verify type checking: `pnpm typecheck`
- Add tests for new features (colocated in the feature's `schemas/` or alongside actions)

<!-- AIOS-MANAGED-START: framework-structure -->
## AIOS Framework Structure

```
aios-core/
├── agents/         # Agent persona definitions (YAML/Markdown)
├── tasks/          # Executable task workflows
├── workflows/      # Multi-step workflow definitions
├── templates/      # Document and code templates
├── checklists/     # Validation and review checklists
└── rules/          # Framework rules and patterns

docs/
├── stories/        # Development stories (numbered)
├── prd/            # Product requirement documents
├── architecture/   # System architecture documentation
└── guides/         # User and developer guides
```
<!-- AIOS-MANAGED-END: framework-structure -->

## Workflow Execution

### Task Execution Pattern
1. Read the complete task/workflow definition
2. Understand all elicitation points
3. Execute steps sequentially
4. Handle errors gracefully
5. Provide clear feedback

### Interactive Workflows
- Workflows with `elicit: true` require user input
- Present options clearly
- Validate user responses
- Provide helpful defaults

## Git & GitHub Integration

### Commit Conventions
- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- Reference story ID: `feat: implement IDE detection [Story 2.1]`
- Keep commits atomic and focused

### GitHub CLI Usage
- Ensure authenticated: `gh auth status`
- Use for PR creation: `gh pr create`
- Check org access: `gh api user/memberships`

<!-- AIOS-MANAGED-START: aios-patterns -->
## AIOS-Specific Patterns

### Working with Templates
```javascript
const template = await loadTemplate('template-name');
const rendered = await renderTemplate(template, context);
```

### Agent Command Handling
```javascript
if (command.startsWith('*')) {
  const agentCommand = command.substring(1);
  await executeAgentCommand(agentCommand, args);
}
```

### Story Updates
```javascript
// Update story progress
const story = await loadStory(storyId);
story.updateTask(taskId, { status: 'completed' });
await story.save();
```
<!-- AIOS-MANAGED-END: aios-patterns -->

<!-- AIOS-MANAGED-START: common-commands -->
## Common Commands

### AIOS Master Commands
- `*help` - Show available commands
- `*create-story` - Create new story
- `*task {name}` - Execute specific task
- `*workflow {name}` - Run workflow

### Development Commands
- `npm run dev` - Start development
- `npm test` - Run tests
- `npm run lint` - Check code style
- `npm run build` - Build project
<!-- AIOS-MANAGED-END: common-commands -->

## Configuration Files

- `.aios-core/core-config.yaml` - AIOS framework configuration
- `.env` / `.env.local` - Environment variables
- `supabase/config.toml` - Supabase local dev config

## Behavioral Rules

### NEVER
- Implement without showing options first (always 1, 2, 3 format)
- Delete/remove content without asking first
- Delete anything created in the last 7 days without explicit approval
- Change something that was already working
- Pretend work is done when it isn't
- Process batch without validating one first
- Add features that weren't requested
- Use mock data when real data exists in database
- Explain/justify when receiving criticism (just fix)
- Trust AI/subagent output without verification
- Create from scratch when similar exists in squads/

### ALWAYS
- Present options as "1. X, 2. Y, 3. Z" format
- Use AskUserQuestion tool for clarifications
- Check squads/ and existing components before creating new
- Read COMPLETE schema before proposing database changes
- Investigate root cause when error persists
- Commit before moving to next task
- Create handoff in `docs/sessions/YYYY-MM/` at end of session

# EnriqueceAI

Plataforma de Sales Engagement para equipes de vendas B2B brasileiras.

## Tech Stack

- **Framework:** Next.js 16+ (App Router)
- **Language:** TypeScript (strict mode)
- **BaaS:** Supabase (Auth, PostgreSQL, Realtime, Storage)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Testing:** Vitest + Testing Library + Playwright

## Requisitos

- Node.js >= 22.0.0
- pnpm >= 10.x
- Supabase CLI (para desenvolvimento local)

## Setup Local

```bash
# 1. Instalar dependências
pnpm install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local
# Editar .env.local com seus valores

# 3. Iniciar Supabase local
npx supabase start

# 4. Executar migrations
npx supabase db reset

# 5. Iniciar dev server
pnpm dev
```

## Comandos

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Inicia o servidor de desenvolvimento |
| `pnpm build` | Cria o build de produção |
| `pnpm start` | Inicia o servidor de produção |
| `pnpm lint` | Verifica linting |
| `pnpm lint:fix` | Corrige problemas de linting |
| `pnpm typecheck` | Verifica tipagem TypeScript |
| `pnpm test` | Executa testes (watch mode) |
| `pnpm test:run` | Executa testes (CI mode) |
| `pnpm test:coverage` | Executa testes com cobertura |
| `pnpm format` | Formata código com Prettier |

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de service role (server-side only) |
| `NEXT_PUBLIC_APP_URL` | URL da aplicação |
| `SENTRY_DSN` | DSN do Sentry (server) |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN do Sentry (client) |

## Estrutura do Projeto

```
src/
├── app/           # Next.js App Router (pages, layouts, API routes)
├── features/      # Feature modules (auth, leads, cadences, etc.)
├── shared/        # Shared components, hooks, types, schemas
├── lib/           # Libraries (supabase clients, auth, utils)
└── config/        # Configuration (env validation)
```

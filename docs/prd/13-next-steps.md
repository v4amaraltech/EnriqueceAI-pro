# Next Steps

## UX Expert Prompt

> @ux-design-expert — Revise o PRD em `docs/prd.md` para o projeto EnriqueceAI. Foco em: (1) validar as 10 core screens propostas e propor wireframes low-fidelity, (2) definir o design system base (paleta azul/roxo, tipografia Inter, ícones Lucide, componentes shadcn/ui), (3) mapear os user flows críticos: importação de leads, criação de cadência, geração de mensagem com IA, (4) garantir WCAG AA compliance. Output: `docs/architecture/frontend-spec.md`.

## Architect Prompt

> @architect — Revise o PRD em `docs/prd.md` para o projeto EnriqueceAI. Stack: Next.js (App Router) + Supabase + shadcn/ui + Tailwind. Foco em: (1) criar o documento de arquitetura com ER diagram, (2) detalhar a estratégia de multi-tenancy com RLS, (3) definir a arquitetura de integrações (Lemit, WhatsApp Business API, Gmail API, CRMs, Claude API), (4) planejar a estratégia de filas e jobs assíncronos (Edge Functions + pg_cron), (5) definir padrões de código e estrutura de projeto. Output: `docs/architecture/architecture.md`.

# Handoff — 2026-06-01: Métrica de leads abertos, features de Execução/Closer/Feedbacks e CI

## Contexto
Sessão longa (V4 Company Amaral, org `c2727473-1df8-4faa-9264-a9fc1759fe3b`).
Começou com uma investigação de "tem bug?" no dashboard e virou um lote de fixes
e features, fechando com a criação do primeiro CI do repo.

## 1. Investigação — card "Leads abertos" (NÃO era bug de cálculo)
A métrica é recalculada ao vivo: conta o **primeiro contato humano de toda a
história do lead** dentro do mês, com lead não-arquivado e `assigned_to` = SDR
ativo. Por isso oscila/cai intradiário. Descobertas:
- API4COM ingere em **tempo real** (2097 calls/10d, atraso máx 0,7h) — refuta a
  hipótese de backfill retroativo.
- **2 bugs reais encontrados e corrigidos** (RPC `count_leads_opened_by_sdr` /
  `_daily`):
  - **Filtro de cadência** ficava no CTE antes do ROW_NUMBER → reordenava o "1º
    toque" e inflava (filtrado 96 > total real 80). Migration `20260601163000`.
  - **Notas de import** (`metadata->>'is_note'='true'`, lista de Reativação como
    `research/sent`) eram contadas como 1º contato → deflacionava. Guilherme em
    junho: **1 → 26**. Migration `20260601174500`.
- **Ambas as migrations já aplicadas em produção** via MCP. Impacto V4 Amaral:
  jun 87→119, mai 1211→905 (mês do import, inflado ~25%), 346 leads "fantasma"
  (atribuídos, nunca contatados de verdade) saem da conta.

## 2. Fix manual — feedback do closer (lead Inobloco)
Feedback foi pro Pedro Neves, mas o closer real era Jhonata. Corrigido no banco:
`closer_id` → Jhonata, request do Pedro expirada, request nova pro Jhonata.
Isso motivou a feature de reatribuição (PR #4).

## 3. PRs abertos (todos verde; nenhum mergeado)
| PR | Branch | Conteúdo |
|----|--------|----------|
| #2 | `fix/leads-abertos-metric` | RPC cadência + notas de import + tooltips. **Migrations já em prod.** |
| #3 | `feat/feedback-current-month` | Feedbacks abre no mês vigente (helper `currentMonthRange`) |
| #4 | `feat/closer-reassignment` | Reatribuir closer + reenviar feedback/briefing (manager) |
| #5 | `feat/activity-sdr-filter` | Filtro de SDR na Execução + remoção da seção "Leads Aguardando Primeira Ligação" (redundante com Power Dialer) |
| #6 | `ci/github-actions-quality-gate` | Primeiro CI: lint/typecheck/test/build |

## 4. CI (PR #6)
Repo não tinha GitHub Actions — único check era Vercel. Novo workflow roda em
PR→main e push→main. **Roda em `TZ=America/Sao_Paulo`**: a primeira execução em
UTC pegou um teste sensível a fuso (`statistics/types/shared.test.ts`) que falha
fora do BRT. Suíte completa: 1335 ✓ em BRT.

## Pendências / ordem de merge
1. Mergear **#6 primeiro** ativa o gate (PRs #2–#5 foram abertos antes e não têm
   o check de CI; re-run ou push trivial após #6 para rodarem o gate).
2. **#4 antes de #5**: ambos adicionam `isManager()` em `src/lib/auth/require-manager.ts`
   (idêntico). O segundo a mergear terá conflito trivial — manter uma cópia.
3. Migrations do #2 já estão em prod; o merge é só sincronia do repo.
4. Aviso não-bloqueante: actions do CI usam Node 20 (deprecação GitHub jun/2026)
   — bumpar versões quando disponíveis.

## Notas técnicas
- `isManager()` (sem redirect) novo em `require-manager.ts` para UI condicional.
- Fila de Execução do manager é org-wide via RLS (`leads_org_read` libera para
  `is_manager()`), por isso o filtro de SDR é client-side por `assigned_to`.

# Story: Feriado nacional conta como fim de semana

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-13 | @devops | PR #470 mesclado (`a79319e`); migration e tipos em prod. Status → Done. |
| 2026-10-13 | @dev (Dex) | Revisão (AJUSTAR) aplicada: Sales Hub passa a usar `overdue_cutoff_brt()`; teste de 23h BRT. Limite do teste de sincronia: para REMOVER feriado é preciso editar o INSERT antigo (o teste lê todas as migrations). |
| 2026-10-13 | @dev (Dex) | Implementado + testado. |
| 2026-10-13 | Vini + Claude | Story criada: 334 de 480 "atrasadas" de 13/10 tinham vencido no feriado de 12/10. |

## Origem

- A régua de atraso (story `overdue-next-business-day`) e o vencimento das tarefas só conheciam sábado e domingo. Feriado era dia útil.
- Terça 13/10, 10h32: 480 tarefas atrasadas no time; **334** tinham vencido na segunda 12/10 (Nossa Senhora Aparecida). Matheus 137/137, Ismael 61/61, Giovanni 8/8.
- Efeitos: tarefa que vence no feriado vira atrasada no dia seguinte, sem ninguém ter trabalhado; o motor envia e-mail de cadência no feriado; o resumo diário do SDR dispara no feriado.

## Story

**As a** SDR / gestor,
**I want** que feriado nacional valha como fim de semana,
**so that** a tarefa que cairia no feriado vá para o próximo dia útil e não vire atraso.

## Acceptance Criteria

1. Lista de feriados nacionais obrigatórios 2026–2028 em `src/lib/utils/br-holidays.ts` e na tabela `public.business_holidays`; teste garante que as duas são iguais.
2. Banco: `is_business_day_brt(date)`; `effective_due_brt` e `skip_weekend_brt` pulam feriado como pulam fim de semana (vencimento novo que cai no feriado → 9h do próximo dia útil).
3. App: `effectiveDueDate` / `overdueCutoff` / `isOverdue` usam a mesma noção de dia útil. Ex.: venceu seg 12/10 (feriado) → atrasada só qua 14/10 9h; venceu sex 09/10 → atrasada ter 13/10 9h.
4. Motor de cadência não envia e-mail em feriado; resumo diário do SDR não dispara em feriado.
6. Card de atrasadas do Sales Hub (`get_sdr_atividades_atrasadas_v4`) usa o mesmo corte do app, via função nova `overdue_cutoff_brt()` (espelho de `overdueCutoff`).
5. Pontos facultativos (Carnaval, Corpus Christi) ficam fora até decisão do gestor.

## Scope

**IN:** migration `20261013120000_business_holidays.sql`, `br-holidays.ts` (+ teste), `overdue.ts` (+ testes), `execute-cadence.ts` (janela), `sdr-overdue-summary.ts`, `pnpm gen:types`.

**OUT:** feriados estaduais/municipais; `nextBusinessDayAt9hBRT` (`meeting-outcome-check`, `feedback`, `lead-noshow`) ainda agenda tarefa para 9h do feriado — o atraso já se corrige pelo `effective_due_brt`, mas a tarefa aparece "para hoje" no feriado; cron `daily-cadence-summary` não checa feriado; contagem de "dias úteis" das metas (`activity-analytics.service.ts`, `meetings-by-day.ts`, `GoalAchievementCard`); recalcular vencimentos já gravados (o card/fila já usam o vencimento efetivo, que passa a pular o feriado).

## Tasks

- [x] Lista + teste de sincronia
- [x] Migration (tabela, `is_business_day_brt`, 2 funções)
- [x] Régua de atraso + testes
- [x] Motor e resumo diário
- [x] Sales Hub (`get_sdr_atividades_atrasadas_v4`) com `overdue_cutoff_brt()`
- [x] typecheck / lint / test:run / build
- [x] Aplicar migration em prod (13/out, MCP) — conferido: 30 feriados, anon não lê a tabela, corte no feriado = sexta 09/10; atrasadas do time 480 → 75
- [x] `pnpm gen:types` (commit separado)
- [x] PR #470

## File List

- `supabase/migrations/20261013120000_business_holidays.sql` (novo)
- `src/lib/utils/br-holidays.ts` (novo) · `br-holidays.test.ts` (novo)
- `src/features/activities/utils/overdue.ts` (modificado) · `overdue.test.ts` (modificado)
- `src/features/cadences/actions/execute-cadence.ts` (modificado)
- `src/features/cadences/actions/sdr-overdue-summary.ts` (modificado)
- `src/lib/supabase/types.ts` (regenerado)
- `docs/stories/business-holidays.story.md` (novo)

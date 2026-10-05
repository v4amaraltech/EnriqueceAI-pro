# Story: "Atrasada" só a partir do dia útil seguinte

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-05 | @dev (Dex) | Implementado + testado. |
| 2026-10-05 | Vini + Claude | Story criada a partir das 143 "atrasadas" do Guilherme na segunda 05/out. |

## Origem

- Segunda 05/out, 17h: o Guilherme tinha **136 tarefas "atrasadas"**, todas com vencimento **hoje às 9h**. Nenhuma era do fim de semana; 32 vieram do sábado/domingo empurradas para segunda (comportamento correto).
- A régua era **4h depois do vencimento** (`OVERDUE_THRESHOLD_HOURS = 4`). Desde set/2026 as tarefas manuais vencem às **9h** (story `next-step-due-9h-brt`) → às **13h** tudo o que não foi feito no dia já ficava vermelho.
- As duas regras se contradizem: a fila nasce às 9h com o dia inteiro, mas a cobrança começava no meio do dia.

## Story

**As a** gestor / SDR,
**I want** que uma tarefa só conte como atrasada depois que o dia útil dela terminou,
**so that** o número de atrasadas mostre pendência real, não a fila do dia.

## Acceptance Criteria

1. Tarefa é "atrasada" quando o vencimento efetivo (já deslocado para o expediente por `effective_due_brt` / `effectiveDueDate`) cai num dia útil **anterior** ao último dia útil cujo expediente (9h BRT) já começou. Na prática: vira atrasada às **9h BRT do dia útil seguinte**.
2. Fim de semana não conta: venceu na sexta → atrasada só na segunda 9h. Vencimento no sábado/domingo → conta como segunda → atrasada na terça 9h.
3. A mesma régua vale em todos os lugares: badge vermelho da fila, filtro "Atrasadas" e contagem "N atrasadas" da fila, filtro do log, card "Atividades Atrasadas" do dashboard e resumo diário do SDR.
4. Texto de ajuda do card do dashboard explica a regra nova.
5. Lembrete de 2h (`activity-reminders`) **não muda** — é aviso, não cobrança.

## Scope

**IN:** `utils/overdue.ts` (`overdueCutoff`, `isOverdue`; sai `OVERDUE_THRESHOLD_HOURS`/`hoursOverdue`), `ActivityRow`, `ActivityQueueView`, `fetch-activity-log`, `ranking-metrics.service` (passa `overdueCutoff()` como `p_cutoff` da RPC — RPC inalterada), tooltip do `DashboardView`, migration do resumo diário (`fetch_overdue_manual_activities`), testes.

**OUT:** feriados (a régua só conhece sábado/domingo, como antes); lembrete de 2h; mudar horário de vencimento das tarefas; Sales Hub.

## Validação no banco (05/out, 17h30 BRT)

| SDR | Régua 4h | Régua nova agora | Amanhã 9h, se nada for feito |
|---|---|---|---|
| Guilherme Marques | 124 | 0 | 124 |
| João Fogaça | 1 | 0 | 1 |
| Demais SDRs | 0 | 0 | 0 |

## Tasks

- [x] `overdueCutoff` + `isOverdue` + testes
- [x] Fila, log e badge usam `isOverdue`
- [x] Dashboard usa `overdueCutoff()` + tooltip
- [x] Migration do resumo diário (`20261005200000`)
- [x] typecheck / lint / test:run / build
- [ ] Aplicar migration em prod (MCP)
- [ ] PR

## File List

- `src/features/activities/utils/overdue.ts` (modificado) · `overdue.test.ts` (novo)
- `src/features/activities/components/ActivityRow.tsx` (modificado) · `ActivityRow.test.ts` (modificado)
- `src/features/activities/components/ActivityQueueView.tsx` (modificado)
- `src/features/activities/actions/fetch-activity-log.ts` (modificado)
- `src/features/dashboard/services/ranking-metrics.service.ts` (modificado)
- `src/features/dashboard/components/DashboardView.tsx` (modificado)
- `src/features/dashboard/types/index.ts` (modificado)
- `src/features/cadences/actions/sdr-overdue-summary.ts` (modificado — comentário)
- `supabase/migrations/20261005200000_overdue_summary_next_business_day.sql` (novo)
- `docs/stories/overdue-next-business-day.story.md` (novo)

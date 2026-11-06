/**
 * Shared "atrasada" definition. Tocar aqui muda 5 lugares de uma vez:
 * - Badge vermelho no card da fila (ActivityRow)
 * - Filtro "Atrasadas" e contagem "N atrasadas" na queue (ActivityQueueView)
 * - Filtro "Atrasadas" no log (fetch-activity-log)
 * - Card "Atividades Atrasadas" no dashboard (fetchOverdueActivitiesRanking)
 * - Resumo diário do SDR (RPC fetch_overdue_manual_activities — espelho SQL)
 *
 * Regra (05/out/2026, story overdue-next-business-day): tarefa é do DIA em que
 * vence. Só vira "atrasada" a partir das 9h BRT do dia útil seguinte — ou seja,
 * quando o SDR teve o expediente inteiro e não fez. Dia útil = seg–sex fora dos
 * feriados nacionais de `@/lib/utils/br-holidays` (13/out/2026, story business-holidays).
 *
 * Histórico: 1h → 4h (26/05/2026) → dia útil seguinte (05/out/2026). Com o
 * vencimento às 9h (set/2026), as 4h faziam tudo virar vermelho às 13h do
 * próprio dia em que a tarefa chegou.
 */

import { isBrBusinessDay } from '@/lib/utils/br-holidays';

/** Início e fim do expediente em horas locais BRT. */
export const BUSINESS_HOURS_START = 9;
export const BUSINESS_HOURS_END = 18;

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo (sem horário de verão desde 2019)
const DAY_MS = 86400 * 1000;

/** `utcMidnightMs` representa um dia do calendário BRT (campos UTC = data BRT). */
function isBusinessDay(utcMidnightMs: number): boolean {
  return isBrBusinessDay(new Date(utcMidnightMs).toISOString().slice(0, 10));
}

function nextBusinessDay(utcMidnightMs: number): number {
  let day = utcMidnightMs + DAY_MS;
  while (!isBusinessDay(day)) day += DAY_MS;
  return day;
}

/**
 * "Desloca" a data de vencimento pra próxima abertura de expediente quando
 * cai fora do horário comercial. Espelha a função SQL `effective_due_brt`.
 * Sem isso, atividade que venceu sex 18h conta como 39h atrasada na seg 9h,
 * mesmo o SDR não tendo trabalhado nesse intervalo.
 *
 * Regras BRT (America/Sao_Paulo):
 * - Antes de 9h em dia útil → 9h do mesmo dia
 * - Depois de 18h em dia útil → 9h do próximo dia útil
 * - Sábado, domingo ou feriado nacional (`br-holidays.ts`) → 9h do próximo dia útil
 * - Dentro de 9h-18h em dia útil → inalterado
 */
export function effectiveDueDate(input: Date | string): Date {
  const date = typeof input === 'string' ? new Date(input) : input;
  const local = new Date(date.getTime() - BRT_OFFSET_MS); // campos UTC = relógio BRT
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const hour = local.getUTCHours();

  let target: number;
  if (isBusinessDay(day)) {
    if (hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END) return date;
    target = hour < BUSINESS_HOURS_START ? day : nextBusinessDay(day);
  } else {
    target = nextBusinessDay(day);
  }
  return new Date(target + BRT_OFFSET_MS + BUSINESS_HOURS_START * 3600 * 1000);
}

/**
 * Corte de "atrasada": 00:00 BRT do dia útil mais recente cujo expediente (9h)
 * já começou. Tarefa cujo vencimento efetivo é anterior a esse corte venceu num
 * dia útil que já terminou → atrasada.
 *
 * Ex.: ter 10h → corte ter 00:00 (o que venceu seg ou antes está atrasado);
 * ter 8h → corte seg 00:00 (o de seg ainda não); sáb → corte sex 00:00.
 * Feriado conta como fim de semana: ter 13/10 10h (seg 12/10 feriado) → corte
 * ter 00:00, e o que venceu no feriado já foi deslocado para ter 9h.
 *
 * O dashboard passa este corte como `p_cutoff` da RPC `list_overdue_activities_brt`.
 * Espelho SQL: `overdue_cutoff_brt()` (usado pelo card do Sales Hub).
 */
export function overdueCutoff(now: Date = new Date()): Date {
  const local = new Date(now.getTime() - BRT_OFFSET_MS); // campos UTC = relógio BRT
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  if (!isBusinessDay(day) || local.getUTCHours() < BUSINESS_HOURS_START) {
    day -= DAY_MS;
    while (!isBusinessDay(day)) day -= DAY_MS;
  }
  return new Date(day + BRT_OFFSET_MS);
}

/**
 * A tarefa está atrasada? Use sempre esta função — não compare datas cruas.
 * Vencimento fora do expediente é deslocado antes (`effectiveDueDate`).
 */
export function isOverdue(nextStepDue: Date | string, now: Date = new Date()): boolean {
  return effectiveDueDate(nextStepDue).getTime() < overdueCutoff(now).getTime();
}

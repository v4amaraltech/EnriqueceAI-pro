/**
 * Shared "atrasada" definition. Tocar aqui muda 4 lugares de uma vez:
 * - Badge vermelho no card da fila (ActivityRow)
 * - Filtro "Atrasadas" na queue (ActivityQueueView)
 * - Filtro "Atrasadas" no log (fetch-activity-log)
 * - Card "Atividades Atrasadas" no dashboard (fetchOverdueActivitiesRanking)
 *
 * Histórico: começou em 1h. Subiu pra 4h em 26/05/2026 a pedido do
 * Vinicius — SDRs estavam vendo o card cheio demais, sem espaço de
 * manobra pra organizar o dia. 4h dá folga de uma manhã/tarde antes do
 * "vermelho" aparecer.
 */
export const OVERDUE_THRESHOLD_HOURS = 4;
export const OVERDUE_THRESHOLD_MS = OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000;

/** Início e fim do expediente em horas locais BRT. */
export const BUSINESS_HOURS_START = 9;
export const BUSINESS_HOURS_END = 18;

/**
 * "Desloca" a data de vencimento pra próxima abertura de expediente quando
 * cai fora do horário comercial. Espelha a lógica do trigger SQL
 * `effective_due_brt`. Sem isso, atividade que venceu sex 18h conta como
 * 39h atrasada na seg 9h, mesmo o SDR não tendo trabalhado nesse intervalo.
 *
 * Regras BRT (America/Sao_Paulo):
 * - Antes de 9h em dia útil → 9h do mesmo dia
 * - Depois de 18h em dia útil → 9h do próximo dia útil
 * - Sábado/domingo → segunda 9h
 * - Dentro de 9h-18h em dia útil → inalterado
 */
export function effectiveDueDate(input: Date | string): Date {
  const date = typeof input === 'string' ? new Date(input) : input;
  // Get BRT components via en-CA (yyyy-mm-dd hh:mm:ss style)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour') === '24' ? '0' : get('hour'));
  const weekday = get('weekday'); // Mon, Tue, ..., Sun

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const beforeBusiness = hour < BUSINESS_HOURS_START;
  const afterBusiness = hour >= BUSINESS_HOURS_END;

  if (!isWeekend && !beforeBusiness && !afterBusiness) {
    return date;
  }

  // Build the target BRT day at 9h local, then convert back to UTC.
  // BRT is fixed UTC-3 (no DST since 2019), so a simple offset works.
  const targetUtcMidnight = Date.UTC(year, month - 1, day) + 3 * 3600 * 1000; // 0h BRT in UTC ms
  let daysToAdd = 0;
  if (isWeekend) {
    daysToAdd = weekday === 'Sat' ? 2 : 1;
  } else if (afterBusiness) {
    // Friday after 18h → +3 days to Monday
    daysToAdd = weekday === 'Fri' ? 3 : 1;
  }
  return new Date(targetUtcMidnight + (daysToAdd * 86400 * 1000) + (BUSINESS_HOURS_START * 3600 * 1000));
}

/**
 * Horas atrasadas relativas ao expediente. Aplica `effectiveDueDate` no
 * vencimento antes de medir o gap pro now. Use sempre que precisar
 * decidir se algo é "atrasada" — não use diff cru.
 */
export function hoursOverdue(nextStepDue: Date | string, now: Date = new Date()): number {
  const effective = effectiveDueDate(nextStepDue).getTime();
  return (now.getTime() - effective) / 3_600_000;
}

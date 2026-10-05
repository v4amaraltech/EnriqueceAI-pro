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
 * quando o SDR teve o expediente inteiro e não fez.
 *
 * Histórico: 1h → 4h (26/05/2026) → dia útil seguinte (05/out/2026). Com o
 * vencimento às 9h (set/2026), as 4h faziam tudo virar vermelho às 13h do
 * próprio dia em que a tarefa chegou.
 */

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

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo (sem horário de verão desde 2019)
const DAY_MS = 86400 * 1000;

function isBusinessDay(utcMidnightMs: number): boolean {
  const dow = new Date(utcMidnightMs).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Corte de "atrasada": 00:00 BRT do dia útil mais recente cujo expediente (9h)
 * já começou. Tarefa cujo vencimento efetivo é anterior a esse corte venceu num
 * dia útil que já terminou → atrasada.
 *
 * Ex.: ter 10h → corte ter 00:00 (o que venceu seg ou antes está atrasado);
 * ter 8h → corte seg 00:00 (o de seg ainda não); sáb → corte sex 00:00.
 *
 * O dashboard passa este corte como `p_cutoff` da RPC `list_overdue_activities_brt`.
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

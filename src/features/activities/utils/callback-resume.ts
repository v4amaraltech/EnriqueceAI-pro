/**
 * Quando a cadência volta depois de um "Pediu para ligar depois".
 *
 * Regra (09/out/2026, story callback-pauses-cadence): o retorno combinado com o
 * lead manda. A cadência fica pausada até as 9h BRT do dia útil SEGUINTE ao
 * retorno — o dia do retorno é só da ligação combinada. Se o lead não avançar,
 * a cadência retoma sozinha a partir daí (o trigger `calculate_next_step_due`
 * aplica o atraso do passo atual a partir da retomada).
 *
 * BRT = UTC-3 fixo (sem horário de verão desde 2019), mesmo atalho do
 * `overdue.ts`. Feriados não entram — igual ao `skip_weekend_brt` do banco.
 */
import { BUSINESS_HOURS_START } from './overdue';

const BRT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export function cadenceResumeAfterReturn(returnAt: Date | string): Date {
  const date = typeof returnAt === 'string' ? new Date(returnAt) : returnAt;
  const local = new Date(date.getTime() - BRT_OFFSET_MS); // campos UTC = relógio BRT
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + DAY_MS;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY_MS;
  return new Date(day + BRT_OFFSET_MS + BUSINESS_HOURS_START * 3600 * 1000);
}

/** "21/10" — data da retomada no fuso BRT, para o aviso ao SDR. */
export function formatResumeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

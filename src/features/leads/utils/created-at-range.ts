import { addDaysIso, brtDateIso, brtDayEndIso, brtDayStartIso } from '@/lib/utils/brt-date';

/**
 * Atalhos do filtro "Criado em" da tela de Leads. Ficam na URL como
 * `created_period=today` (e não como datas concretas) para que um favorito
 * "Leads de hoje" continue certo amanhã.
 */
export const CREATED_PERIOD_VALUES = ['today', 'yesterday', '7d', 'month'] as const;
export type CreatedPeriod = (typeof CREATED_PERIOD_VALUES)[number];

export const CREATED_PERIOD_LABELS: Record<CreatedPeriod, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': 'Últimos 7 dias',
  month: 'Este mês',
};

export interface CreatedAtFilterInput {
  created_period?: CreatedPeriod;
  created_from?: string; // YYYY-MM-DD (dia BRT)
  created_to?: string; // YYYY-MM-DD (dia BRT)
}

export interface CreatedAtRange {
  gte?: string; // ISO UTC — início do dia BRT
  lte?: string; // ISO UTC — fim do dia BRT
}

/**
 * Converte o filtro "Criado em" num intervalo ISO UTC para `.gte`/`.lte` em
 * `created_at`. Todos os dias são dias de Brasília (UTC-3): "Hoje" às 22h BRT
 * ainda é hoje, mesmo que em UTC já seja o dia seguinte.
 *
 * O atalho (`created_period`) tem precedência sobre o período personalizado.
 * Devolve `null` quando não há filtro.
 */
export function createdAtRange(input: CreatedAtFilterInput, now: Date = new Date()): CreatedAtRange | null {
  const today = brtDateIso(now);

  switch (input.created_period) {
    case 'today':
      return { gte: brtDayStartIso(today), lte: brtDayEndIso(today) };
    case 'yesterday': {
      const y = addDaysIso(today, -1);
      return { gte: brtDayStartIso(y), lte: brtDayEndIso(y) };
    }
    case '7d':
      return { gte: brtDayStartIso(addDaysIso(today, -6)), lte: brtDayEndIso(today) };
    case 'month':
      return { gte: brtDayStartIso(`${today.slice(0, 7)}-01`), lte: brtDayEndIso(today) };
    default:
      break;
  }

  if (!input.created_from && !input.created_to) return null;
  const range: CreatedAtRange = {};
  if (input.created_from) range.gte = brtDayStartIso(input.created_from);
  if (input.created_to) range.lte = brtDayEndIso(input.created_to);
  return range;
}

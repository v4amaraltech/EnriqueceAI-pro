import { addDaysIso, brtDateIso, brtDayEndIso, brtDayStartIso } from '@/lib/utils/brt-date';

import { phoneSearchDigits, splitSearchTerms } from '@/features/leads/utils/lead-search';

import { LEAD_STAGES, type LeadStageKey } from './lead-insights';

/**
 * Data em que o lead entrou na etapa. A etapa continua vindo de
 * `cockpit_lead_stages`. Quando a coluna está vazia, o período usa `updated_at`,
 * menos Entrada, que é sempre `created_at`.
 *
 * Conexão estabelecida não tem coluna própria: a SQL marca a etapa por ligação
 * conectada ou resposta. `qualified_at` é o carimbo mais próximo; sem ele, `updated_at`.
 * Reunião realizada usa `meeting_held_at` e, se faltar, `won_at` (a SQL também
 * classifica `won_at` como SAL). Sem os dois, `updated_at`.
 */
export const STAGE_ENTERED_FIELD = {
  desqualificado: 'lost_at',
  entrada: 'created_at',
  tentativa: 'contacted_at',
  conexao: 'qualified_at',
  sql: 'meeting_scheduled_at',
  no_show: 'meeting_no_show_at',
  sal: 'meeting_held_at',
} as const;

export const PORTFOLIO_PERIODS = ['today', '7d', '30d', 'month', 'custom'] as const;
export type PortfolioPeriod = (typeof PORTFOLIO_PERIODS)[number];

export interface PortfolioFilters {
  /** null = Tudo, o comportamento atual, sem corte de data. */
  period: PortfolioPeriod | null;
  from: string | null;
  to: string | null;
  stage: LeadStageKey | null;
}

export interface PortfolioRange {
  gte: string;
  lte: string;
}

export interface StageDates {
  created_at: string;
  updated_at: string;
  lost_at: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  meeting_scheduled_at: string | null;
  meeting_no_show_at: string | null;
  meeting_held_at: string | null;
  won_at: string | null;
}

export interface PortfolioItem {
  id: string;
  stage: LeadStageKey;
  dates: StageDates;
  updatedAt: string;
  haystack: string;
  phoneDigits: string;
  cnpj: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLeadStage(value: string | null | undefined): value is LeadStageKey {
  return LEAD_STAGES.some((stage) => stage.key === value);
}

export function parsePortfolioFilters(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  stage?: string | null;
}): PortfolioFilters {
  const period = PORTFOLIO_PERIODS.includes(input.period as PortfolioPeriod)
    ? (input.period as PortfolioPeriod)
    : null;
  return {
    period,
    from: input.from && DATE_RE.test(input.from) ? input.from : null,
    to: input.to && DATE_RE.test(input.to) ? input.to : null,
    stage: isLeadStage(input.stage) ? input.stage : null,
  };
}

/** Intervalo BRT do período. `null` significa Tudo. */
export function portfolioRange(filters: PortfolioFilters, now: Date = new Date()): PortfolioRange | null {
  if (!filters.period) return null;
  const today = brtDateIso(now);
  if (filters.period === 'today') {
    return { gte: brtDayStartIso(today), lte: brtDayEndIso(today) };
  }
  if (filters.period === '7d') {
    return { gte: brtDayStartIso(addDaysIso(today, -6)), lte: brtDayEndIso(today) };
  }
  if (filters.period === '30d') {
    return { gte: brtDayStartIso(addDaysIso(today, -29)), lte: brtDayEndIso(today) };
  }
  if (filters.period === 'month') {
    return { gte: brtDayStartIso(`${today.slice(0, 7)}-01`), lte: brtDayEndIso(today) };
  }
  if (!filters.from && !filters.to) return null;
  const start = filters.from && filters.to && filters.from > filters.to ? filters.to : filters.from;
  const end = filters.from && filters.to && filters.from > filters.to ? filters.from : filters.to;
  return {
    gte: start ? brtDayStartIso(start) : '0001-01-01T00:00:00.000Z',
    lte: end ? brtDayEndIso(end) : '9999-12-31T23:59:59.999Z',
  };
}

export function stageEnteredAt(stage: LeadStageKey, dates: StageDates): string {
  if (stage === 'entrada') return dates.created_at;
  if (stage === 'sal') return dates.meeting_held_at ?? dates.won_at ?? dates.updated_at;
  const field = STAGE_ENTERED_FIELD[stage];
  const value = dates[field];
  return typeof value === 'string' && value ? value : dates.updated_at;
}

export function inPortfolioPeriod(iso: string, range: PortfolioRange | null): boolean {
  if (!range) return true;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return time >= new Date(range.gte).getTime() && time <= new Date(range.lte).getTime();
}

export function matchesPortfolioSearch(
  item: Pick<PortfolioItem, 'haystack' | 'phoneDigits' | 'cnpj'>,
  search: string,
): boolean {
  const allTerms = splitSearchTerms(search);
  if (allTerms.length === 0) return true;
  const longTerms = allTerms.filter((term) => term.length >= 3);
  const terms = longTerms.length > 0 ? longTerms : allTerms;
  const cnpjDigits = item.cnpj.replace(/\D/g, '');
  return terms.every((raw) => {
    if (item.haystack.includes(raw.toLowerCase())) return true;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 3 && digits !== raw && cnpjDigits.includes(digits)) return true;
    const phone = phoneSearchDigits(raw);
    return !!phone && item.phoneDigits.includes(phone);
  });
}

export function emptyStageCounts(): Record<LeadStageKey, number> {
  return {
    desqualificado: 0,
    entrada: 0,
    tentativa: 0,
    conexao: 0,
    sql: 0,
    no_show: 0,
    sal: 0,
  };
}

/**
 * Cartões e lista passam pelo mesmo corte de data e etapa.
 * A busca só reduz a lista. A contagem do cartão não muda com ela.
 */
export function applyPortfolio<T extends PortfolioItem>(
  items: T[],
  input: { range: PortfolioRange | null; stage: LeadStageKey | null; search: string },
): { counts: Record<LeadStageKey, number>; matches: T[] } {
  const counts = emptyStageCounts();
  const inPeriod: T[] = [];
  for (const item of items) {
    if (!inPortfolioPeriod(stageEnteredAt(item.stage, item.dates), input.range)) continue;
    counts[item.stage] += 1;
    inPeriod.push(item);
  }
  const searched = input.search.trim()
    ? inPeriod.filter((item) => matchesPortfolioSearch(item, input.search))
    : inPeriod;
  const staged = input.stage ? searched.filter((item) => item.stage === input.stage) : searched;
  const matches = [...staged].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return { counts, matches };
}

export function portfolioNeedsScan(filters: PortfolioFilters, range: PortfolioRange | null): boolean {
  return filters.stage !== null || range !== null;
}

/**
 * Ritmo dos cards da seção "SDR selecionado" — porte fiel do `/sdrs` do Sales
 * Hub (`PaceKpiCard` + `lib/pace.ts` + `buildTeamKPIs`), para os dois painéis
 * lerem o mesmo número do mesmo jeito. Os dias úteis vêm de `pacing.ts`
 * (seg–sex menos feriados nacionais), a mesma régua do resto do dashboard.
 *
 * Duas réguas, de propósito (igual ao Sales Hub e aos cards atuais):
 *  - o MARCADOR da barra e a cor usam os dias úteis FECHADOS (até ontem);
 *  - o "hoje: N" usa o ideal até o FIM de hoje (inclui a cota de hoje) —
 *    é o que falta fazer hoje para fechar o dia no ritmo, não o que foi feito.
 */
import { brtNowParts, currentDayOfMonthBrt } from './brt-now';
import { businessDaysInMonth, businessDaysThrough } from './pacing';

export type PaceStatus = 'above' | 'on-track' | 'attention' | 'critical' | 'neutral';

export interface MonthPaceCalendar {
  /** Mês avaliado é o mês corrente (BRT). */
  isCurrent: boolean;
  /** Dias úteis do mês inteiro. */
  total: number;
  /** Dias úteis já fechados (até ontem no mês corrente; o mês todo no passado). */
  elapsed: number;
  /** `elapsed` + hoje, quando hoje é dia útil. */
  throughToday: number;
  /** Dias úteis que sobram, INCLUINDO hoje. */
  remaining: number;
  /** `elapsed / total` — posição do marcador de ritmo na barra. */
  paceFraction: number;
}

export function monthPaceCalendar(month: string): MonthPaceCalendar {
  const [year, month1] = month.split('-').map(Number) as [number, number];
  const now = brtNowParts();
  const isCurrent = now.year === year && now.month1 === month1;
  const total = businessDaysInMonth(year, month1);
  const elapsed = businessDaysThrough(year, month1, currentDayOfMonthBrt(month));
  const throughToday = isCurrent ? businessDaysThrough(year, month1, now.day) : elapsed;
  return {
    isCurrent,
    total,
    elapsed,
    throughToday,
    remaining: Math.max(0, total - elapsed),
    paceFraction: total > 0 ? elapsed / total : 0,
  };
}

/**
 * Saúde relativa ao ritmo. Verde só quando atinge o ideal; perto dele, amarelo.
 * Sem ritmo para comparar (mês fechado ou 1º dia útil) → contra a meta cheia.
 */
export function getPaceStatus(pct: number | null, paceFraction: number, isCurrent: boolean): PaceStatus {
  if (pct == null) return 'neutral';
  if (!isCurrent || paceFraction <= 0) {
    if (pct >= 1) return 'above';
    if (pct >= 0.3) return 'attention';
    return 'critical';
  }
  const ratio = pct / paceFraction;
  if (ratio >= 1.1) return 'above';
  if (ratio >= 1) return 'on-track';
  if (ratio >= 0.7) return 'attention';
  return 'critical';
}

/** Taxa não acumula com o mês: é medida direto contra a meta, sem ritmo. */
export function getRateStatus(pct: number | null): PaceStatus {
  if (pct == null) return 'neutral';
  if (pct >= 1.1) return 'above';
  if (pct >= 1) return 'on-track';
  if (pct >= 0.7) return 'attention';
  return 'critical';
}

export interface VolumeKpi {
  actual: number;
  target: number;
  /** real ÷ meta (0..1+); `null` sem meta. */
  pct: number | null;
  status: PaceStatus;
  /** Marcador do ideal na barra; `null` fora do mês corrente ou no 1º dia útil. */
  markerFraction: number | null;
  /** O que falta HOJE para fechar o dia no ritmo; no ritmo → a cota normal do dia. */
  today: { value: number; onTrack: boolean } | null;
  /** real − ideal até ontem (só no mês corrente com meta). */
  deltaVsPace: number | null;
  /** meta − real; `null` quando já bateu ou sem meta. */
  remaining: number | null;
  /** Ritmo necessário por dia útil até o fim do mês (inclui hoje). */
  perDay: number | null;
}

export function buildVolumeKpi(actual: number, target: number, cal: MonthPaceCalendar): VolumeKpi {
  const hasTarget = target > 0;
  const pct = hasTarget ? actual / target : null;
  const paced = cal.isCurrent && cal.paceFraction > 0;

  let today: VolumeKpi['today'] = null;
  let perDay: number | null = null;
  let deltaVsPace: number | null = null;
  if (cal.isCurrent && hasTarget && cal.total > 0) {
    const dailyQuota = target / cal.total;
    const needToday = Math.ceil(dailyQuota * cal.throughToday - actual);
    const onTrack = needToday <= 0;
    today = { value: onTrack ? Math.ceil(dailyQuota) : needToday, onTrack };
    if (target - actual > 0 && cal.remaining > 0) perDay = (target - actual) / cal.remaining;
    deltaVsPace = actual - target * cal.paceFraction;
  }

  const left = Math.round(target - actual);
  return {
    actual,
    target,
    pct,
    status: getPaceStatus(pct, cal.paceFraction, cal.isCurrent),
    markerFraction: paced ? Math.min(1, cal.paceFraction) : null,
    today,
    deltaVsPace,
    remaining: hasTarget && left > 0 ? left : null,
    perDay,
  };
}

export interface RateKpi {
  /** Taxa realizada (0..1); 0 quando o denominador é 0. */
  actual: number;
  /** Taxa meta derivada das metas de volume; `null` sem meta. */
  target: number | null;
  /** taxa real ÷ taxa meta; `null` sem meta. */
  pct: number | null;
  status: PaceStatus;
}

/**
 * Taxa derivada de dois volumes (ex.: conectadas ÷ ligações). A meta também é
 * derivada das metas de volume — igual ao Sales Hub, não existe meta de taxa.
 */
export function buildRateKpi(
  numerator: number,
  denominator: number,
  numeratorTarget: number,
  denominatorTarget: number,
): RateKpi {
  const actual = denominator > 0 ? numerator / denominator : 0;
  const target = denominatorTarget > 0 && numeratorTarget > 0 ? numeratorTarget / denominatorTarget : null;
  const pct = target ? actual / target : null;
  return { actual, target, pct, status: getRateStatus(pct) };
}

/** "9,5" / "106" — 1 casa decimal só quando o ritmo é pequeno (igual ao Sales Hub). */
export function formatPerDay(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: n < 10 ? 1 : 0 });
}

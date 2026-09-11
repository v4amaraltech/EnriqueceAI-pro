import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRateKpi,
  buildVolumeKpi,
  formatPerDay,
  getPaceStatus,
  getRateStatus,
  monthPaceCalendar,
} from './sdr-pace';

// Sexta, 11/set/2026, 09:00 BRT. Setembro/2026 tem 21 dias úteis (22 dias de
// semana menos o feriado de 07/set). Fechados até ontem: 1–4 e 8–10 = 7.
const FRI_11_SEP_0900_BRT = new Date('2026-09-11T12:00:00Z');

describe('monthPaceCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_11_SEP_0900_BRT);
  });
  afterEach(() => vi.useRealTimers());

  it('mês corrente: dias úteis fechados até ontem, hoje conta no "throughToday" e no "remaining"', () => {
    expect(monthPaceCalendar('2026-09')).toEqual({
      isCurrent: true,
      total: 21,
      elapsed: 7,
      throughToday: 8,
      remaining: 14,
      paceFraction: 7 / 21,
    });
  });

  it('fim de semana não soma dia útil no "hoje"', () => {
    vi.setSystemTime(new Date('2026-09-12T15:00:00Z')); // sábado
    const cal = monthPaceCalendar('2026-09');
    expect(cal.elapsed).toBe(8);
    expect(cal.throughToday).toBe(8);
    expect(cal.remaining).toBe(13);
  });

  it('feriado (07/set) não soma dia útil no "hoje"', () => {
    vi.setSystemTime(new Date('2026-09-07T15:00:00Z'));
    const cal = monthPaceCalendar('2026-09');
    expect(cal.elapsed).toBe(4);
    expect(cal.throughToday).toBe(4);
  });

  it('1º dia do mês: nada fechado ainda, sem marcador de ritmo', () => {
    vi.setSystemTime(new Date('2026-09-01T15:00:00Z'));
    const cal = monthPaceCalendar('2026-09');
    expect(cal.elapsed).toBe(0);
    expect(cal.throughToday).toBe(1);
    expect(cal.paceFraction).toBe(0);
  });

  it('mês passado: tudo fechado, não é corrente', () => {
    const cal = monthPaceCalendar('2026-08');
    expect(cal.isCurrent).toBe(false);
    expect(cal.elapsed).toBe(cal.total);
    expect(cal.remaining).toBe(0);
    expect(cal.paceFraction).toBe(1);
  });
});

describe('buildVolumeKpi — paridade com o /sdrs do Sales Hub (Matheus, 11/set/2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_11_SEP_0900_BRT);
  });
  afterEach(() => vi.useRealTimers());

  it('Leads Abertos 91/300 → 30%, amarelo, hoje 24, faltam 209 · 15/dia', () => {
    const kpi = buildVolumeKpi(91, 300, monthPaceCalendar('2026-09'));
    expect(Math.round((kpi.pct ?? 0) * 100)).toBe(30);
    expect(kpi.status).toBe('attention');
    expect(kpi.today).toEqual({ value: 24, onTrack: false });
    expect(kpi.remaining).toBe(209);
    expect(formatPerDay(kpi.perDay ?? 0)).toBe('15');
    expect(kpi.markerFraction).toBeCloseTo(1 / 3);
  });

  it('Reuniões Marcadas 4/20 → 20%, vermelho, hoje 4, faltam 16 · 1,1/dia', () => {
    const kpi = buildVolumeKpi(4, 20, monthPaceCalendar('2026-09'));
    expect(kpi.status).toBe('critical');
    expect(kpi.today).toEqual({ value: 4, onTrack: false });
    expect(kpi.remaining).toBe(16);
    expect(formatPerDay(kpi.perDay ?? 0)).toBe('1,1');
  });

  it('Total de Ligações 834/2.200 → 38%, verde, hoje 5, faltam 1.366 · 98/dia', () => {
    const kpi = buildVolumeKpi(834, 2200, monthPaceCalendar('2026-09'));
    expect(Math.round((kpi.pct ?? 0) * 100)).toBe(38);
    expect(kpi.status).toBe('above');
    expect(kpi.today).toEqual({ value: 5, onTrack: false });
    expect(kpi.remaining).toBe(1366);
    expect(formatPerDay(kpi.perDay ?? 0)).toBe('98');
  });

  it('Ligações Conectadas 46/176 → 26%, amarelo, hoje 22, faltam 130 · 9,3/dia', () => {
    const kpi = buildVolumeKpi(46, 176, monthPaceCalendar('2026-09'));
    expect(kpi.status).toBe('attention');
    expect(kpi.today).toEqual({ value: 22, onTrack: false });
    expect(formatPerDay(kpi.perDay ?? 0)).toBe('9,3');
  });

  it('no ritmo → mostra a cota normal do dia', () => {
    const kpi = buildVolumeKpi(120, 300, monthPaceCalendar('2026-09'));
    expect(kpi.today).toEqual({ value: 15, onTrack: true }); // ceil(300/21)
  });

  it('meta batida → sem "faltam" nem "/dia"', () => {
    const kpi = buildVolumeKpi(320, 300, monthPaceCalendar('2026-09'));
    expect(kpi.remaining).toBeNull();
    expect(kpi.perDay).toBeNull();
    expect(kpi.status).toBe('above');
  });

  it('meta 0 → card neutro', () => {
    const kpi = buildVolumeKpi(50, 0, monthPaceCalendar('2026-09'));
    expect(kpi.pct).toBeNull();
    expect(kpi.status).toBe('neutral');
    expect(kpi.today).toBeNull();
    expect(kpi.remaining).toBeNull();
  });

  it('mês passado → sem marcador nem "hoje", cor pela meta cheia', () => {
    const kpi = buildVolumeKpi(250, 300, monthPaceCalendar('2026-08'));
    expect(kpi.markerFraction).toBeNull();
    expect(kpi.today).toBeNull();
    expect(kpi.perDay).toBeNull();
    expect(kpi.remaining).toBe(50);
    expect(kpi.status).toBe('attention');
  });
});

describe('buildRateKpi', () => {
  it('Conectada p/ Marcada 4/46 contra 20/176 → 9% / 11%, amarelo', () => {
    const kpi = buildRateKpi(4, 46, 20, 176);
    expect(Math.round(kpi.actual * 100)).toBe(9);
    expect(Math.round((kpi.target ?? 0) * 100)).toBe(11);
    expect(Math.round((kpi.pct ?? 0) * 100)).toBe(77);
    expect(kpi.status).toBe('attention');
  });

  it('% de Conectadas 46/834 contra 176/2.200 → 6% / 8%, vermelho', () => {
    const kpi = buildRateKpi(46, 834, 176, 2200);
    expect(Math.round(kpi.actual * 100)).toBe(6);
    expect(Math.round((kpi.target ?? 0) * 100)).toBe(8);
    expect(Math.round((kpi.pct ?? 0) * 100)).toBe(69);
    expect(kpi.status).toBe('critical');
  });

  it('sem denominador → taxa 0; sem meta → neutro', () => {
    expect(buildRateKpi(3, 0, 20, 176).actual).toBe(0);
    const noGoal = buildRateKpi(4, 46, 20, 0);
    expect(noGoal.target).toBeNull();
    expect(noGoal.status).toBe('neutral');
  });
});

describe('status', () => {
  it('ritmo: ≥1,1 acima, ≥1 no ritmo, ≥0,7 atenção, abaixo crítico', () => {
    expect(getPaceStatus(0.55, 0.5, true)).toBe('above');
    expect(getPaceStatus(0.5, 0.5, true)).toBe('on-track');
    expect(getPaceStatus(0.35, 0.5, true)).toBe('attention');
    expect(getPaceStatus(0.3, 0.5, true)).toBe('critical');
  });

  it('sem ritmo (mês fechado ou 1º dia útil): ≥100% verde, ≥30% amarelo', () => {
    expect(getPaceStatus(1, 1, false)).toBe('above');
    expect(getPaceStatus(0.3, 0, true)).toBe('attention');
    expect(getPaceStatus(0.29, 1, false)).toBe('critical');
  });

  it('taxa: mesmos cortes, direto contra a meta', () => {
    expect(getRateStatus(1.1)).toBe('above');
    expect(getRateStatus(1)).toBe('on-track');
    expect(getRateStatus(0.7)).toBe('attention');
    expect(getRateStatus(0.69)).toBe('critical');
    expect(getRateStatus(null)).toBe('neutral');
  });
});

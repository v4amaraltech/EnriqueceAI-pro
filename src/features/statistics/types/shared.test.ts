import { describe, expect, it } from 'vitest';

import { formatDuration, formatDurationLong, getPeriodDates, safeRate } from './shared';

describe('safeRate', () => {
  it('returns 0 when denominator is 0', () => {
    expect(safeRate(5, 0)).toBe(0);
  });

  it('calculates percentage correctly', () => {
    expect(safeRate(1, 3)).toBe(33.3);
    expect(safeRate(2, 3)).toBe(66.7);
    expect(safeRate(3, 3)).toBe(100);
  });

  it('returns 0 for 0 numerator', () => {
    expect(safeRate(0, 10)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(130)).toBe('02:10');
  });
});

describe('formatDurationLong', () => {
  it('formats seconds as Xh Ym', () => {
    expect(formatDurationLong(3661)).toBe('1h 1m');
    expect(formatDurationLong(120)).toBe('2m');
    expect(formatDurationLong(7200)).toBe('2h 0m');
  });
});

describe('getPeriodDates', () => {
  it('returns start and end ISO strings', () => {
    const { start, end } = getPeriodDates('30d');
    expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
  });

  it('handles today period', () => {
    const { start } = getPeriodDates('today');
    const startDate = new Date(start);
    const now = new Date();
    expect(startDate.getFullYear()).toBe(now.getFullYear());
    expect(startDate.getMonth()).toBe(now.getMonth());
    expect(startDate.getDate()).toBe(now.getDate());
  });

  it('defaults to 30d for unknown period', () => {
    const { start } = getPeriodDates('unknown');
    const diff = Date.now() - new Date(start).getTime();
    const days = diff / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

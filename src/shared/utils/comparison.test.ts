import { describe, expect, it } from 'vitest';

import { calculateDelta, calculatePreviousPeriod, formatPeriodLabel } from './comparison';

describe('calculatePreviousPeriod', () => {
  it('calculates mirror period for 15-day range', () => {
    const result = calculatePreviousPeriod('2026-03-01', '2026-03-15');
    expect(result).toEqual({ from: '2026-02-14', to: '2026-02-28' });
  });

  it('calculates mirror period for 7-day range', () => {
    const result = calculatePreviousPeriod('2026-03-08', '2026-03-14');
    expect(result).toEqual({ from: '2026-03-01', to: '2026-03-07' });
  });

  it('calculates mirror period for 30-day range', () => {
    const result = calculatePreviousPeriod('2026-03-01', '2026-03-30');
    expect(result).toEqual({ from: '2026-01-30', to: '2026-02-28' });
  });

  it('calculates mirror period for 1-day range', () => {
    const result = calculatePreviousPeriod('2026-03-15', '2026-03-15');
    expect(result).toEqual({ from: '2026-03-14', to: '2026-03-14' });
  });

  it('calculates mirror period for 90-day range', () => {
    const result = calculatePreviousPeriod('2026-01-01', '2026-03-31');
    expect(result).toEqual({ from: '2025-10-03', to: '2025-12-31' });
  });
});

describe('calculateDelta', () => {
  it('returns positive delta', () => {
    const result = calculateDelta(150, 100);
    expect(result).toEqual({
      percentage: 50,
      absolute: 50,
      previousValue: 100,
      direction: 'up',
    });
  });

  it('returns negative delta', () => {
    const result = calculateDelta(80, 100);
    expect(result).toEqual({
      percentage: -20,
      absolute: -20,
      previousValue: 100,
      direction: 'down',
    });
  });

  it('returns neutral delta when equal', () => {
    const result = calculateDelta(100, 100);
    expect(result).toEqual({
      percentage: 0,
      absolute: 0,
      previousValue: 100,
      direction: 'neutral',
    });
  });

  it('returns null percentage when previous is 0', () => {
    const result = calculateDelta(50, 0);
    expect(result).toEqual({
      percentage: null,
      absolute: 50,
      previousValue: 0,
      direction: 'up',
    });
  });

  it('returns neutral when both are 0', () => {
    const result = calculateDelta(0, 0);
    expect(result).toEqual({
      percentage: null,
      absolute: 0,
      previousValue: 0,
      direction: 'neutral',
    });
  });

  it('handles decimal percentages', () => {
    const result = calculateDelta(133, 100);
    expect(result.percentage).toBe(33);
    expect(result.direction).toBe('up');
  });
});

describe('formatPeriodLabel', () => {
  it('formats same-month range', () => {
    const result = formatPeriodLabel('2026-03-01', '2026-03-15');
    expect(result).toBe('01 mar — 15 mar');
  });

  it('formats cross-month range', () => {
    const result = formatPeriodLabel('2026-02-14', '2026-03-15');
    expect(result).toBe('14 fev — 15 mar');
  });
});

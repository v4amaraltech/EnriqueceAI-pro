import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentMonthRange } from './date-range';

describe('currentMonthRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 1st of the month → today (month-to-date)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T10:00:00'));
    expect(currentMonthRange()).toEqual({ from: '2026-06-01', to: '2026-06-15' });
  });

  it('collapses to a single day on the 1st', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00'));
    expect(currentMonthRange()).toEqual({ from: '2026-06-01', to: '2026-06-01' });
  });
});

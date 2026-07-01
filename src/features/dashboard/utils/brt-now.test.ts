import { afterEach, describe, expect, it, vi } from 'vitest';

import { brtNowParts, currentDayOfMonthBrt, currentMonthBrt } from './brt-now';

afterEach(() => {
  vi.useRealTimers();
});

/** Freeze wall-clock to a specific UTC instant. */
function freezeUtc(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('brt-now', () => {
  it('does NOT roll to the next month at 23:00 BRT on the last day (02:00Z next day)', () => {
    // 2026-06-30 23:00 BRT === 2026-07-01 02:00 UTC — the bug that emptied the dashboard.
    freezeUtc('2026-07-01T02:00:00Z');
    expect(currentMonthBrt()).toBe('2026-06');
    expect(brtNowParts()).toEqual({ year: 2026, month1: 6, day: 30 });
  });

  it('rolls to the next month exactly at 00:00 BRT (03:00Z)', () => {
    freezeUtc('2026-07-01T03:00:00Z'); // 2026-07-01 00:00 BRT
    expect(currentMonthBrt()).toBe('2026-07');
    expect(brtNowParts()).toEqual({ year: 2026, month1: 7, day: 1 });
  });

  it('stays in the same month mid-day', () => {
    freezeUtc('2026-06-15T18:00:00Z'); // 2026-06-15 15:00 BRT
    expect(currentMonthBrt()).toBe('2026-06');
    expect(brtNowParts().day).toBe(15);
  });

  it('handles year rollover at 00:00 BRT on Jan 1 (03:00Z)', () => {
    freezeUtc('2027-01-01T03:00:00Z');
    expect(currentMonthBrt()).toBe('2027-01');
    expect(brtNowParts()).toEqual({ year: 2027, month1: 1, day: 1 });
  });

  describe('currentDayOfMonthBrt', () => {
    it('returns today (BRT) when the month is the current BRT month', () => {
      freezeUtc('2026-06-15T18:00:00Z'); // 15/jun BRT
      expect(currentDayOfMonthBrt('2026-06')).toBe(15);
    });

    it('returns the last day for a fully-elapsed past month', () => {
      freezeUtc('2026-06-15T18:00:00Z');
      expect(currentDayOfMonthBrt('2026-05')).toBe(31);
      expect(currentDayOfMonthBrt('2026-02')).toBe(28);
    });

    it('treats 23:00 BRT on the last day as still the current month', () => {
      freezeUtc('2026-07-01T02:00:00Z'); // 30/jun 23:00 BRT
      expect(currentDayOfMonthBrt('2026-06')).toBe(30);
    });
  });
});

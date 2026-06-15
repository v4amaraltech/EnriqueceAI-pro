import { describe, expect, it } from 'vitest';

import { businessDaysInMonth, businessDaysThrough, expectedByBusinessDay } from './pacing';

// June 2026: 1st is a Monday. 30 calendar days, 22 business days.
// Weekends fall on: 6,7 / 13,14 / 20,21 / 27,28.
describe('businessDaysThrough (June 2026)', () => {
  it('counts only weekdays up to a given day', () => {
    expect(businessDaysThrough(2026, 6, 1)).toBe(1); // Mon
    expect(businessDaysThrough(2026, 6, 5)).toBe(5); // Mon–Fri
    expect(businessDaysThrough(2026, 6, 7)).toBe(5); // +Sat,Sun → still 5
    expect(businessDaysThrough(2026, 6, 15)).toBe(11); // through the 15th (a Monday)
  });

  it('does not increment across weekend days', () => {
    expect(businessDaysThrough(2026, 6, 6)).toBe(businessDaysThrough(2026, 6, 5)); // Sat
    expect(businessDaysThrough(2026, 6, 7)).toBe(businessDaysThrough(2026, 6, 5)); // Sun
  });
});

describe('businessDaysInMonth', () => {
  it('counts all weekdays in the month', () => {
    expect(businessDaysInMonth(2026, 6)).toBe(22); // June 2026
    expect(businessDaysInMonth(2026, 2)).toBe(20); // Feb 2026 (28 days)
  });
});

describe('expectedByBusinessDay', () => {
  it('paces the target linearly over business days', () => {
    // 1500 target, day 15 → 11/22 business days elapsed → 750.
    expect(expectedByBusinessDay(1500, 2026, 6, 15)).toBeCloseTo((1500 / 22) * 11);
    // Same calendar day under the OLD calendar-day pace would have been 750
    // (1500/30*15). The business-day pace lands on the same number here only by
    // coincidence; the point is weekends no longer push it up mid-week.
  });

  it('returns the full target once the month is fully elapsed', () => {
    expect(expectedByBusinessDay(1500, 2026, 6, 30)).toBeCloseTo(1500);
  });

  it('returns 0 for non-positive target', () => {
    expect(expectedByBusinessDay(0, 2026, 6, 15)).toBe(0);
    expect(expectedByBusinessDay(-10, 2026, 6, 15)).toBe(0);
  });

  it('stays flat across a weekend', () => {
    const fri = expectedByBusinessDay(1500, 2026, 6, 5); // Friday
    const sat = expectedByBusinessDay(1500, 2026, 6, 6);
    const sun = expectedByBusinessDay(1500, 2026, 6, 7);
    expect(sat).toBeCloseTo(fri);
    expect(sun).toBeCloseTo(fri);
  });
});

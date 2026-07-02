import { describe, expect, it } from 'vitest';

import { businessDaysBetween, businessDaysInMonth, businessDaysThrough, expectedByBusinessDay } from './pacing';

// July 2026 is free of national holidays — use it for pure weekday semantics.
// July 1 2026 is a Wednesday. Weekends: 4,5 / 11,12 / 18,19 / 25,26.
describe('businessDaysBetween — weekdays only (July 2026, holiday-free)', () => {
  it('counts an inclusive Mon–Fri week as 5', () => {
    expect(businessDaysBetween('2026-07-06T12:00:00Z', '2026-07-10T12:00:00Z')).toBe(5);
  });

  it('ignores weekend days inside the range', () => {
    // Mon 6 → Sun 12 includes Sat 11 + Sun 12 → still 5 weekdays.
    expect(businessDaysBetween('2026-07-06T12:00:00Z', '2026-07-12T12:00:00Z')).toBe(5);
  });

  it('counts the full month as 23 business days', () => {
    expect(businessDaysBetween('2026-07-01T12:00:00Z', '2026-07-31T12:00:00Z')).toBe(23);
  });

  it('clamps a weekend-only range to 1 (safe divisor)', () => {
    expect(businessDaysBetween('2026-07-04T12:00:00Z', '2026-07-05T12:00:00Z')).toBe(1);
  });

  it('returns 1 when end precedes start', () => {
    expect(businessDaysBetween('2026-07-10T12:00:00Z', '2026-07-01T12:00:00Z')).toBe(1);
  });
});

describe('businessDaysThrough / businessDaysInMonth — weekdays only (July 2026)', () => {
  it('counts only weekdays up to a given day', () => {
    expect(businessDaysThrough(2026, 7, 1)).toBe(1); // Wed
    expect(businessDaysThrough(2026, 7, 3)).toBe(3); // Wed–Fri
    expect(businessDaysThrough(2026, 7, 5)).toBe(3); // +Sat,Sun → still 3
    expect(businessDaysThrough(2026, 7, 10)).toBe(8);
  });

  it('counts all weekdays in the month', () => {
    expect(businessDaysInMonth(2026, 7)).toBe(23);
  });
});

// National holidays (fixed + facultativos Carnaval/Corpus Christi) are excluded.
describe('holidays are excluded from the business-day count', () => {
  it('drops a fixed national holiday on a weekday (Independência, Mon 07/09/2026)', () => {
    // Sept 2026: Sept 1 is a Tuesday, 22 weekdays; minus 07/09 (Mon) → 21.
    expect(businessDaysInMonth(2026, 9)).toBe(21);
  });

  it('drops Corpus Christi (Thu 04/06/2026)', () => {
    // June 2026: 22 weekdays; Corpus Christi 04/06 (Thu) → 21.
    expect(businessDaysInMonth(2026, 6)).toBe(21);
    // Through the 5th: Mon1..Fri5 = 5 weekdays minus Corpus Christi (Thu 4) → 4.
    expect(businessDaysThrough(2026, 6, 5)).toBe(4);
  });

  it('drops Carnaval Mon+Tue (16–17/02/2026)', () => {
    // Feb 2026: Feb 1 is a Sunday, 20 weekdays; minus Carnaval 16,17 → 18.
    expect(businessDaysInMonth(2026, 2)).toBe(18);
  });

  it('does not double-count a holiday that falls on a weekend', () => {
    // Nov 2026: Nov 1 is a Sunday, 21 weekdays. 02 (Mon, Finados) and 20 (Fri,
    // Consciência Negra) are weekdays → 19. 15 (Sun, Proclamação) already a weekend.
    expect(businessDaysInMonth(2026, 11)).toBe(19);
  });
});

describe('expectedByBusinessDay', () => {
  it('paces the target linearly over business days (July 2026, holiday-free)', () => {
    // 2300 target, day 10 → 8/23 business days elapsed.
    expect(expectedByBusinessDay(2300, 2026, 7, 10)).toBeCloseTo((2300 / 23) * 8);
  });

  it('returns the full target once the month is fully elapsed', () => {
    expect(expectedByBusinessDay(1500, 2026, 7, 31)).toBeCloseTo(1500);
  });

  it('returns 0 for non-positive target', () => {
    expect(expectedByBusinessDay(0, 2026, 7, 15)).toBe(0);
    expect(expectedByBusinessDay(-10, 2026, 7, 15)).toBe(0);
  });

  it('stays flat across a weekend', () => {
    const fri = expectedByBusinessDay(2300, 2026, 7, 3); // Friday
    const sat = expectedByBusinessDay(2300, 2026, 7, 4);
    const sun = expectedByBusinessDay(2300, 2026, 7, 5);
    expect(sat).toBeCloseTo(fri);
    expect(sun).toBeCloseTo(fri);
  });

  it('stays flat across a holiday (Corpus Christi 04/06/2026)', () => {
    const wed = expectedByBusinessDay(2100, 2026, 6, 3); // day before the holiday
    const thu = expectedByBusinessDay(2100, 2026, 6, 4); // Corpus Christi — no increment
    expect(thu).toBeCloseTo(wed);
  });
});

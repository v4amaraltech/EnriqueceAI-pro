import { describe, expect, it } from 'vitest';

import { formatMonthLabel, isMonth, monthEndBrt, shiftMonth } from './month';

describe('month utils', () => {
  it('valida YYYY-MM', () => {
    expect(isMonth('2026-11')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth(undefined)).toBe(false);
  });

  it('anda meses atravessando o ano', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('formata e acha o fim do mês em BRT', () => {
    expect(formatMonthLabel('2026-11')).toBe('novembro 2026');
    expect(monthEndBrt('2026-11').toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});

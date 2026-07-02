import { describe, expect, it } from 'vitest';

import { isHolidayBr } from './holidays-br';

describe('isHolidayBr — fixed national holidays', () => {
  it('recognizes fixed-date national holidays', () => {
    expect(isHolidayBr(2026, 1, 1)).toBe(true); // Confraternização
    expect(isHolidayBr(2026, 4, 21)).toBe(true); // Tiradentes
    expect(isHolidayBr(2026, 5, 1)).toBe(true); // Trabalho
    expect(isHolidayBr(2026, 9, 7)).toBe(true); // Independência
    expect(isHolidayBr(2026, 10, 12)).toBe(true); // Aparecida
    expect(isHolidayBr(2026, 11, 2)).toBe(true); // Finados
    expect(isHolidayBr(2026, 11, 15)).toBe(true); // Proclamação
    expect(isHolidayBr(2026, 11, 20)).toBe(true); // Consciência Negra
    expect(isHolidayBr(2026, 12, 25)).toBe(true); // Natal
  });

  it('rejects ordinary days', () => {
    expect(isHolidayBr(2026, 7, 15)).toBe(false);
    expect(isHolidayBr(2026, 3, 10)).toBe(false);
    expect(isHolidayBr(2026, 8, 20)).toBe(false);
  });
});

describe('isHolidayBr — movable (Easter-based) holidays', () => {
  // Easter 2026 = 05/04.
  it('recognizes 2026 movable dates', () => {
    expect(isHolidayBr(2026, 4, 3)).toBe(true); // Sexta-feira Santa (Páscoa − 2)
    expect(isHolidayBr(2026, 2, 16)).toBe(true); // Carnaval segunda (Páscoa − 48)
    expect(isHolidayBr(2026, 2, 17)).toBe(true); // Carnaval terça (Páscoa − 47)
    expect(isHolidayBr(2026, 6, 4)).toBe(true); // Corpus Christi (Páscoa + 60)
  });

  // Easter 2027 = 28/03 — verifies the computus works for another year.
  it('recognizes 2027 movable dates', () => {
    expect(isHolidayBr(2027, 3, 26)).toBe(true); // Sexta-feira Santa
    expect(isHolidayBr(2027, 5, 27)).toBe(true); // Corpus Christi
  });
});

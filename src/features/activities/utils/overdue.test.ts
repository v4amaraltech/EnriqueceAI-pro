import { describe, expect, it } from 'vitest';

import { isOverdue, overdueCutoff } from './overdue';

// 05/out/2026 é segunda-feira. Horários em BRT (-03:00).
const brt = (s: string) => new Date(`${s}-03:00`);

describe('overdueCutoff', () => {
  it('dia útil depois das 9h → 00:00 do próprio dia', () => {
    expect(overdueCutoff(brt('2026-10-06T10:00:00'))).toEqual(brt('2026-10-06T00:00:00'));
  });

  it('dia útil antes das 9h → 00:00 do dia útil anterior', () => {
    expect(overdueCutoff(brt('2026-10-06T08:59:00'))).toEqual(brt('2026-10-05T00:00:00'));
  });

  it('segunda antes das 9h → 00:00 da sexta', () => {
    expect(overdueCutoff(brt('2026-10-05T08:00:00'))).toEqual(brt('2026-10-02T00:00:00'));
  });

  it('sábado e domingo → 00:00 da sexta', () => {
    expect(overdueCutoff(brt('2026-10-03T15:00:00'))).toEqual(brt('2026-10-02T00:00:00'));
    expect(overdueCutoff(brt('2026-10-04T23:00:00'))).toEqual(brt('2026-10-02T00:00:00'));
  });

  it('usa o dia BRT, não o UTC (22h BRT = 01h UTC do dia seguinte)', () => {
    expect(overdueCutoff(brt('2026-10-06T22:00:00'))).toEqual(brt('2026-10-06T00:00:00'));
  });
});

describe('isOverdue', () => {
  it('venceu hoje às 9h → não é atrasada no mesmo dia, nem às 17h', () => {
    expect(isOverdue(brt('2026-10-05T09:00:00'), brt('2026-10-05T17:18:00'))).toBe(false);
  });

  it('venceu hoje → vira atrasada às 9h do dia útil seguinte', () => {
    const due = brt('2026-10-05T09:00:00');
    expect(isOverdue(due, brt('2026-10-06T08:59:00'))).toBe(false);
    expect(isOverdue(due, brt('2026-10-06T09:00:00'))).toBe(true);
  });

  it('venceu na sexta → só vira atrasada na segunda 9h', () => {
    const due = brt('2026-10-02T14:00:00');
    expect(isOverdue(due, brt('2026-10-03T12:00:00'))).toBe(false);
    expect(isOverdue(due, brt('2026-10-05T08:00:00'))).toBe(false);
    expect(isOverdue(due, brt('2026-10-05T09:00:00'))).toBe(true);
  });

  it('vencimento no sábado conta como segunda → atrasada só na terça 9h', () => {
    const due = brt('2026-10-03T09:00:00');
    expect(isOverdue(due, brt('2026-10-05T17:00:00'))).toBe(false);
    expect(isOverdue(due, brt('2026-10-06T09:00:00'))).toBe(true);
  });

  it('vencimento depois das 18h conta como o dia útil seguinte', () => {
    const due = brt('2026-10-05T19:00:00'); // → ter 9h
    expect(isOverdue(due, brt('2026-10-06T17:00:00'))).toBe(false);
    expect(isOverdue(due, brt('2026-10-07T09:00:00'))).toBe(true);
  });

  it('vencimento de vários dias atrás → atrasada', () => {
    expect(isOverdue(brt('2026-09-29T09:00:00'), brt('2026-10-05T10:00:00'))).toBe(true);
  });

  it('aceita string ISO', () => {
    expect(isOverdue('2026-10-02T12:00:00.000Z', brt('2026-10-05T10:00:00'))).toBe(true);
  });
});

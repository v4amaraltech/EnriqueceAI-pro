import { describe, expect, it } from 'vitest';

import { buildWeekSlots, formatBrtWallClock, slotSelectable, startOfWorkWeek } from './week-slots';

describe('week slots', () => {
  const monday = new Date('2026-11-09T12:00:00.000Z');

  it('a semana de trabalho começa na segunda BRT', () => {
    expect(startOfWorkWeek(monday).toISOString()).toBe('2026-11-09T03:00:00.000Z');
    expect(startOfWorkWeek(new Date('2026-11-15T15:00:00.000Z')).toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });

  it('marca ocupado o horário que cruza o calendário e bloqueia o passado', () => {
    const now = new Date('2026-11-09T12:30:00.000Z');
    const slots = buildWeekSlots(startOfWorkWeek(monday), [
      { start: '2026-11-09T14:00:00.000Z', end: '2026-11-09T15:00:00.000Z' },
    ], now);
    const nine = slots.find((s) => s.dayIndex === 0 && s.hour === 9);
    const eleven = slots.find((s) => s.dayIndex === 0 && s.hour === 11);
    const fourteen = slots.find((s) => s.dayIndex === 0 && s.hour === 14);
    expect(nine && slotSelectable(nine)).toBe(false);
    expect(eleven?.busy).toBe(true);
    expect(fourteen && slotSelectable(fourteen)).toBe(true);
    expect(slots.filter((s) => s.dayIndex === 0)).toHaveLength(10);
  });

  it('formata o relógio de parede em BRT', () => {
    expect(formatBrtWallClock(new Date('2026-11-09T14:00:00.000Z'))).toEqual({
      date: '2026-11-09',
      time: '11:00',
      dayMonth: '09/11',
    });
  });
});

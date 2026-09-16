import { describe, expect, it } from 'vitest';

import { createdAtRange } from './created-at-range';

// 16/set/2026 23:30 BRT = 17/set 02:30 UTC — em UTC já é "amanhã".
const lateNightBrt = new Date('2026-09-17T02:30:00.000Z');

describe('createdAtRange', () => {
  it('sem filtro devolve null', () => {
    expect(createdAtRange({}, lateNightBrt)).toBeNull();
  });

  it('"Hoje" usa o dia BRT, não o UTC, perto da meia-noite', () => {
    expect(createdAtRange({ created_period: 'today' }, lateNightBrt)).toEqual({
      gte: '2026-09-16T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('"Ontem" é o dia BRT anterior inteiro', () => {
    expect(createdAtRange({ created_period: 'yesterday' }, lateNightBrt)).toEqual({
      gte: '2026-09-15T03:00:00.000Z',
      lte: '2026-09-16T02:59:59.999Z',
    });
  });

  it('"Últimos 7 dias" inclui hoje e os 6 dias anteriores', () => {
    expect(createdAtRange({ created_period: '7d' }, lateNightBrt)).toEqual({
      gte: '2026-09-10T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('"Este mês" vai do dia 1 até o fim de hoje', () => {
    expect(createdAtRange({ created_period: 'month' }, lateNightBrt)).toEqual({
      gte: '2026-09-01T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('"Ontem" atravessa a virada de mês', () => {
    const firstOfMonth = new Date('2026-10-01T12:00:00.000Z');
    expect(createdAtRange({ created_period: 'yesterday' }, firstOfMonth)).toEqual({
      gte: '2026-09-30T03:00:00.000Z',
      lte: '2026-10-01T02:59:59.999Z',
    });
  });

  it('período personalizado usa de/até em dias BRT', () => {
    expect(createdAtRange({ created_from: '2026-09-01', created_to: '2026-09-10' })).toEqual({
      gte: '2026-09-01T03:00:00.000Z',
      lte: '2026-09-11T02:59:59.999Z',
    });
  });

  it('período personalizado aceita só "de" ou só "até"', () => {
    expect(createdAtRange({ created_from: '2026-09-01' })).toEqual({ gte: '2026-09-01T03:00:00.000Z' });
    expect(createdAtRange({ created_to: '2026-09-10' })).toEqual({ lte: '2026-09-11T02:59:59.999Z' });
  });

  it('atalho tem precedência sobre o período personalizado', () => {
    const r = createdAtRange({ created_period: 'today', created_from: '2020-01-01' }, lateNightBrt);
    expect(r?.gte).toBe('2026-09-16T03:00:00.000Z');
  });
});

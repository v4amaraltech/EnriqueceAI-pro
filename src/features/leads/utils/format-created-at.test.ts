import { describe, expect, it } from 'vitest';

import { formatCreatedAt } from './format-created-at';

// 16/set/2026 23:30 BRT (= 17/set 02:30 UTC)
const now = new Date('2026-09-17T02:30:00.000Z');

describe('formatCreatedAt', () => {
  it('lead criado hoje (em BRT) mostra "Hoje HH:mm" e destaca', () => {
    // 16/set 21:05 BRT = 17/set 00:05 UTC — em UTC já é outro dia
    const r = formatCreatedAt('2026-09-17T00:05:00.000Z', now);
    expect(r.label).toBe('Hoje 21:05');
    expect(r.isToday).toBe(true);
    expect(r.title).toBe('16/09/2026, 21:05');
  });

  it('lead criado ontem mostra "Ontem"', () => {
    const r = formatCreatedAt('2026-09-16T01:00:00.000Z', now); // 15/set 22:00 BRT
    expect(r.label).toBe('Ontem');
    expect(r.isToday).toBe(false);
  });

  it('menos de 7 dias mostra "há N dias"', () => {
    expect(formatCreatedAt('2026-09-13T15:00:00.000Z', now).label).toBe('há 3 dias');
  });

  it('mesmo ano mostra dd/MM', () => {
    expect(formatCreatedAt('2026-03-05T15:00:00.000Z', now).label).toBe('05/03');
  });

  it('ano diferente mostra dd/MM/aa', () => {
    expect(formatCreatedAt('2025-12-24T15:00:00.000Z', now).label).toBe('24/12/25');
  });

  it('data inválida não quebra', () => {
    expect(formatCreatedAt('not-a-date', now).label).toBe('—');
  });
});

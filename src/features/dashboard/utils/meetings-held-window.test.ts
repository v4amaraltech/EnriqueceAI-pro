import { describe, expect, it } from 'vitest';

import { meetingHeldAnchor, meetingsHeldWindowFilter } from './meetings-held-window';

describe('meetingHeldAnchor', () => {
  it('conta pelo horário do evento quando ele existe', () => {
    expect(
      meetingHeldAnchor({
        meeting_starts_at: '2026-08-31T21:00:00Z',
        meeting_held_at: '2026-09-01T00:02:47Z',
      }),
    ).toBe('2026-08-31T21:00:00Z');
  });

  it('cai no carimbo quando não há evento registrado (ganho sem agendamento)', () => {
    expect(
      meetingHeldAnchor({ meeting_starts_at: null, meeting_held_at: '2026-04-15T13:00:00Z' }),
    ).toBe('2026-04-15T13:00:00Z');
  });
});

describe('meetingsHeldWindowFilter', () => {
  const start = '2026-09-01T03:00:00Z';
  const end = '2026-09-30T23:59:59-03:00';
  const now = '2026-09-10T15:00:00.000Z';
  const [comEvento, semEvento] = meetingsHeldWindowFilter(start, end, now).split(',and(');

  it('conta reunião com evento só dentro do período e só depois que ela passou', () => {
    expect(comEvento).toContain(`meeting_starts_at.gte.${start}`);
    expect(comEvento).toContain(`meeting_starts_at.lt.${end}`);
    // Teto em "agora": ganho adiantado não conta a reunião antes dela acontecer.
    expect(comEvento).toContain(`meeting_starts_at.lte.${now}`);
  });

  it('conta ganho sem evento registrado pelo carimbo, no mesmo período', () => {
    expect(semEvento).toContain('meeting_starts_at.is.null');
    expect(semEvento).toContain(`meeting_held_at.gte.${start}`);
    expect(semEvento).toContain(`meeting_held_at.lt.${end}`);
  });
});

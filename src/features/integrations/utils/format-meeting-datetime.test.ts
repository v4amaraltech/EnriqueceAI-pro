import { describe, expect, it } from 'vitest';

import { formatMeetingDateTime } from './format-meeting-datetime';

describe('formatMeetingDateTime', () => {
  it('formats a naive São Paulo datetime exactly as entered (no TZ shift)', () => {
    // The incident: a 17:30 meeting must render as 17:30, never 14:30.
    expect(formatMeetingDateTime('2026-06-23T17:30:00')).toBe('23/06/2026, 17:30');
    expect(formatMeetingDateTime('2026-06-23T09:00:00')).toBe('23/06/2026, 09:00');
  });

  it('works without a seconds component', () => {
    expect(formatMeetingDateTime('2026-06-23T17:30')).toBe('23/06/2026, 17:30');
  });

  it('converts an explicit -03:00 offset to São Paulo wall-clock', () => {
    expect(formatMeetingDateTime('2026-06-23T17:30:00-03:00')).toBe('23/06/2026, 17:30');
  });

  it('converts a UTC (Z) instant to São Paulo wall-clock (−3h)', () => {
    // 20:30Z == 17:30 in America/Sao_Paulo
    expect(formatMeetingDateTime('2026-06-23T20:30:00Z')).toBe('23/06/2026, 17:30');
  });
});

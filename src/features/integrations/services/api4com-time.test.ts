import { describe, expect, it } from 'vitest';

import { parseApi4ComTimestamp, toApi4ComFilterTimestamp } from './api4com-time';

describe('parseApi4ComTimestamp', () => {
  it('adds 3h to the REST BRT-disguised-as-Z stamp', () => {
    expect(parseApi4ComTimestamp('2026-05-14T10:00:44.000Z')?.toISOString()).toBe('2026-05-14T13:00:44.000Z');
  });

  it('returns null for empty or malformed input', () => {
    expect(parseApi4ComTimestamp(null)).toBeNull();
    expect(parseApi4ComTimestamp('')).toBeNull();
    expect(parseApi4ComTimestamp('not-a-date')).toBeNull();
  });
});

describe('toApi4ComFilterTimestamp', () => {
  it('subtracts 3h to reach the API4COM clock', () => {
    expect(toApi4ComFilterTimestamp(new Date('2026-09-10T17:00:00.000Z'))).toBe('2026-09-10T14:00:00.000Z');
  });

  it('round-trips with parseApi4ComTimestamp', () => {
    const real = new Date('2026-09-10T17:23:45.678Z');
    expect(parseApi4ComTimestamp(toApi4ComFilterTimestamp(real))?.getTime()).toBe(real.getTime());
  });

  // Regression: the 2026-09-10 17:00 UTC cron run (2.5h window) sent real-UTC
  // bounds and got `fetched: 0` — a call made at 13:30 BRT fell outside them.
  it('puts a call from inside the window between the filter bounds', () => {
    const now = new Date('2026-09-10T17:00:00.000Z'); // 14:00 BRT
    const since = new Date(now.getTime() - 2.5 * 3600 * 1000); // 11:30 BRT
    const callStartedAt = '2026-09-10T13:30:00.000Z'; // 13:30 BRT as API4COM stores it

    const gte = toApi4ComFilterTimestamp(since);
    const lte = toApi4ComFilterTimestamp(now);

    expect(callStartedAt >= gte && callStartedAt <= lte).toBe(true);
    // The old real-UTC bounds excluded it.
    expect(callStartedAt >= since.toISOString() && callStartedAt <= now.toISOString()).toBe(false);
  });
});

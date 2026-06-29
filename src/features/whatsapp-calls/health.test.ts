import { describe, expect, it } from 'vitest';

import { computeNumberHealth } from './health';

describe('computeNumberHealth', () => {
  it('is healthy with low volume / low failure', () => {
    expect(computeNumberHealth(3, 0).health).toBe('healthy');
    expect(computeNumberHealth(20, 2).health).toBe('healthy');
  });

  it('flags degraded when not_connected rate is high (with enough sample)', () => {
    // 10 calls, 6 not connected = 60% ≥ 50%
    expect(computeNumberHealth(10, 6).health).toBe('degraded');
  });

  it('does NOT flag degraded below the minimum sample', () => {
    // 4 calls (< HEALTH_MIN_SAMPLE), even all failed → still healthy (noise)
    expect(computeNumberHealth(4, 4).health).toBe('healthy');
  });

  it('reports limit at/above the daily cap (takes precedence over degraded)', () => {
    const u = computeNumberHealth(50, 40);
    expect(u.health).toBe('limit');
  });

  it('computes the not_connected rate', () => {
    expect(computeNumberHealth(8, 2).notConnectedRate).toBeCloseTo(0.25);
    expect(computeNumberHealth(0, 0).notConnectedRate).toBe(0);
  });
});

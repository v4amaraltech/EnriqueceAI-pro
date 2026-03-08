import { describe, expect, it } from 'vitest';

import { calculateEngagementScore, type InteractionSignal } from './engagement-score.service';

const NOW = new Date('2026-03-08T12:00:00Z');

function signal(type: string, daysAgo: number): InteractionSignal {
  const date = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { type, created_at: date.toISOString() };
}

describe('calculateEngagementScore', () => {
  it('returns null for empty interactions', () => {
    expect(calculateEngagementScore([], NOW)).toBeNull();
  });

  it('scores a recent reply at ~20', () => {
    const score = calculateEngagementScore([signal('replied', 0)], NOW);
    expect(score).toBe(20);
  });

  it('scores a recent meeting_scheduled at 30', () => {
    const score = calculateEngagementScore([signal('meeting_scheduled', 0)], NOW);
    expect(score).toBe(30);
  });

  it('applies time decay to older interactions', () => {
    const recent = calculateEngagementScore([signal('replied', 1)], NOW)!;
    const old = calculateEngagementScore([signal('replied', 80)], NOW)!;
    expect(recent).toBeGreaterThan(old);
  });

  it('bounce reduces score', () => {
    const withoutBounce = calculateEngagementScore([signal('sent', 0)], NOW)!;
    const withBounce = calculateEngagementScore(
      [signal('sent', 0), signal('bounced', 0)],
      NOW,
    )!;
    expect(withBounce).toBeLessThan(withoutBounce);
  });

  it('clamps score to 0 (not negative)', () => {
    const score = calculateEngagementScore(
      [signal('bounced', 0), signal('bounced', 0), signal('failed', 0)],
      NOW,
    );
    expect(score).toBe(0);
  });

  it('clamps score to 100 max', () => {
    const interactions = Array.from({ length: 10 }, (_, i) =>
      signal('meeting_scheduled', i),
    );
    const score = calculateEngagementScore(interactions, NOW);
    expect(score).toBe(100);
  });

  it('handles mixed positive and negative signals', () => {
    const score = calculateEngagementScore(
      [
        signal('sent', 0),      // +2
        signal('opened', 0),    // +5
        signal('replied', 0),   // +20
        signal('bounced', 1),   // -10 * ~0.99
      ],
      NOW,
    )!;
    // ~2 + 5 + 20 - 9.9 = ~17
    expect(score).toBeGreaterThan(15);
    expect(score).toBeLessThan(20);
  });

  it('uses minimum decay for very old interactions', () => {
    // 89 days old → decay = max(0.1, 1 - 89/90) = ~0.011 → uses 0.1
    const score = calculateEngagementScore([signal('replied', 89)], NOW)!;
    // 20 * ~0.011 = ~0.22 → rounds to 0. But MIN_DECAY is 0.1 → 20 * 0.1 = 2
    expect(score).toBe(2);
  });

  it('ignores unknown interaction types', () => {
    const score = calculateEngagementScore([signal('unknown_type', 0)], NOW);
    expect(score).toBe(0);
  });
});

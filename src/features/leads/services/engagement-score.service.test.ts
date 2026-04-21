import { describe, expect, it } from 'vitest';

import { calculateEngagementScore, type InteractionSignal } from './engagement-score.service';

const NOW = new Date('2026-03-08T12:00:00Z');

function signal(type: string, daysAgo: number, channel?: string): InteractionSignal {
  const date = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { type, channel, created_at: date.toISOString() };
}

describe('calculateEngagementScore', () => {
  it('returns null for empty interactions', () => {
    expect(calculateEngagementScore([], NOW)).toBeNull();
  });

  it('scores a recent email reply at ~25', () => {
    const score = calculateEngagementScore([signal('replied', 0, 'email')], NOW);
    expect(score).toBe(25);
  });

  it('scores a recent meeting_scheduled at 30', () => {
    const score = calculateEngagementScore([signal('meeting_scheduled', 0)], NOW);
    expect(score).toBe(30);
  });

  it('applies time decay to older interactions', () => {
    const recent = calculateEngagementScore([signal('replied', 1, 'email')], NOW)!;
    const old = calculateEngagementScore([signal('replied', 80, 'email')], NOW)!;
    expect(recent).toBeGreaterThan(old);
  });

  it('bounce reduces score', () => {
    const withoutBounce = calculateEngagementScore([signal('sent', 0, 'email')], NOW)!;
    const withBounce = calculateEngagementScore(
      [signal('sent', 0, 'email'), signal('bounced', 0, 'email')],
      NOW,
    )!;
    expect(withBounce).toBeLessThan(withoutBounce);
  });

  it('clamps score to 0 (not negative)', () => {
    const score = calculateEngagementScore(
      [signal('bounced', 0, 'email'), signal('bounced', 0, 'email'), signal('failed', 0, 'email')],
      NOW,
    );
    expect(score).toBe(0);
  });

  it('clamps score to 100 max', () => {
    const interactions = Array.from({ length: 10 }, (_, i) =>
      signal('meeting_scheduled', i, 'calendar'),
    );
    const score = calculateEngagementScore(interactions, NOW);
    expect(score).toBe(100);
  });

  it('handles mixed positive and negative signals', () => {
    const score = calculateEngagementScore(
      [
        signal('sent', 0, 'email'),      // +2
        signal('opened', 0, 'email'),    // +5
        signal('replied', 0, 'email'),   // +25
        signal('bounced', 1, 'email'),   // -10 * ~0.99
      ],
      NOW,
    )!;
    // ~2 + 5 + 25 - 9.9 = ~22
    expect(score).toBeGreaterThan(20);
    expect(score).toBeLessThan(25);
  });

  it('uses minimum decay for very old interactions', () => {
    const score = calculateEngagementScore([signal('replied', 89, 'email')], NOW)!;
    // 25 * 0.1 = 2.5 → rounds to 3
    expect(score).toBe(3);
  });

  it('ignores unknown interaction types', () => {
    const score = calculateEngagementScore([signal('unknown_type', 0)], NOW);
    expect(score).toBe(0);
  });

  // Channel-specific weight tests
  describe('channel-specific weights', () => {
    it('phone sent weighs more than email sent', () => {
      const phone = calculateEngagementScore([signal('sent', 0, 'phone')], NOW)!;
      const email = calculateEngagementScore([signal('sent', 0, 'email')], NOW)!;
      expect(phone).toBeGreaterThan(email); // 5 vs 2
    });

    it('whatsapp sent weighs more than email sent', () => {
      const whatsapp = calculateEngagementScore([signal('sent', 0, 'whatsapp')], NOW)!;
      const email = calculateEngagementScore([signal('sent', 0, 'email')], NOW)!;
      expect(whatsapp).toBeGreaterThan(email); // 4 vs 2
    });

    it('research sent weighs less than email sent', () => {
      const research = calculateEngagementScore([signal('sent', 0, 'research')], NOW)!;
      const email = calculateEngagementScore([signal('sent', 0, 'email')], NOW)!;
      expect(research).toBeLessThan(email); // 1 vs 2
    });

    it('system sent contributes zero', () => {
      const score = calculateEngagementScore([signal('sent', 0, 'system')], NOW)!;
      expect(score).toBe(0);
    });

    it('phone call + whatsapp + email builds higher score than emails alone', () => {
      const multiChannel = calculateEngagementScore([
        signal('sent', 0, 'phone'),     // 5
        signal('sent', 0, 'whatsapp'),  // 4
        signal('sent', 0, 'email'),     // 2
      ], NOW)!;
      const emailOnly = calculateEngagementScore([
        signal('sent', 0, 'email'),     // 2
        signal('sent', 0, 'email'),     // 2
        signal('sent', 0, 'email'),     // 2
      ], NOW)!;
      expect(multiChannel).toBeGreaterThan(emailOnly); // 11 vs 6
    });

    it('falls back to base weight when channel is undefined', () => {
      const noChannel = calculateEngagementScore([signal('sent', 0)], NOW)!;
      const emailChannel = calculateEngagementScore([signal('sent', 0, 'email')], NOW)!;
      expect(noChannel).toBe(emailChannel); // both use base weight 2
    });
  });
});

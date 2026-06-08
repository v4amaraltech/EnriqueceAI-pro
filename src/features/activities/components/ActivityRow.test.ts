import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatRelativeTime } from './ActivityRow';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "Agora" for just now', () => {
    const result = formatRelativeTime(new Date().toISOString());
    expect(result.text).toBe('Agora');
    expect(result.isUrgent).toBe(false);
  });

  it('should return minutes for < 60 min', () => {
    const date = new Date(Date.now() - 30 * 60000); // 30 min ago
    const result = formatRelativeTime(date.toISOString());
    expect(result.text).toBe('Há 30min');
    expect(result.isUrgent).toBe(false);
  });

  it('should return hours for < 24h', () => {
    const date = new Date(Date.now() - 3 * 3600000); // 3 hours ago
    const result = formatRelativeTime(date.toISOString());
    expect(result.text).toBe('Há 3h');
    // 3h overdue is below the 4h business-hours threshold (business-hours
    // clamp can only reduce overdue, never increase it) → not urgent.
    expect(result.isUrgent).toBe(false);
  });

  it('should return days for >= 24h', () => {
    // Fixed mid-week "now" so "2 days ago" is also a business day. Otherwise the
    // business-hours overdue clamp drops isUrgent when the test runs on a Monday
    // (2 days ago lands on the weekend), making it flaky by day-of-week.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:00:00-03:00')); // Wednesday 15h BRT
    const date = new Date(Date.now() - 2 * 24 * 3600000); // 2 days ago → Monday
    const result = formatRelativeTime(date.toISOString());
    expect(result.text).toBe('Há 2d');
    expect(result.isUrgent).toBe(true);
  });

  it('should not mark urgent below the 4h threshold (1h overdue)', () => {
    // Threshold raised from 1h → 4h on 26/05/2026 (OVERDUE_THRESHOLD_HOURS).
    const date = new Date(Date.now() - 60 * 60000); // 1h ago
    const result = formatRelativeTime(date.toISOString());
    expect(result.isUrgent).toBe(false);
  });

  it('should not mark urgent at 59 min', () => {
    const date = new Date(Date.now() - 59 * 60000); // 59 min ago
    const result = formatRelativeTime(date.toISOString());
    expect(result.isUrgent).toBe(false);
  });
});

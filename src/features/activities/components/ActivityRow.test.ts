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

  it('should return hours for < 24h, not urgent on the same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:00:00-03:00')); // Wednesday 15h BRT
    const date = new Date(Date.now() - 3 * 3600000); // 3 hours ago, same day
    const result = formatRelativeTime(date.toISOString());
    expect(result.text).toBe('Há 3h');
    // Tarefa do dia: só vira atrasada às 9h do dia útil seguinte.
    expect(result.isUrgent).toBe(false);
  });

  it('should return days for >= 24h', () => {
    // Fixed mid-week "now" so "2 days ago" is also a business day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:00:00-03:00')); // Wednesday 15h BRT
    const date = new Date(Date.now() - 2 * 24 * 3600000); // 2 days ago → Monday
    const result = formatRelativeTime(date.toISOString());
    expect(result.text).toBe('Há 2d');
    expect(result.isUrgent).toBe(true);
  });

  it('should mark urgent from 9h of the next business day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T09:30:00-03:00')); // Thursday 9h30 BRT
    const result = formatRelativeTime('2026-06-10T15:00:00-03:00'); // Wednesday 15h
    expect(result.text).toBe('Há 18h');
    expect(result.isUrgent).toBe(true);
  });

  it('should not mark urgent at 59 min', () => {
    const date = new Date(Date.now() - 59 * 60000); // 59 min ago
    const result = formatRelativeTime(date.toISOString());
    expect(result.isUrgent).toBe(false);
  });
});

import { renderHook, act } from '@testing-library/react';
import { format, subDays } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDateRange, parseDateRangeParams } from './useDateRange';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => currentParams,
}));

let currentParams: URLSearchParams;

function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
function daysAgo(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd');
}

beforeEach(() => {
  currentParams = new URLSearchParams();
  vi.clearAllMocks();
});

describe('useDateRange', () => {
  it('returns default 30-day range when no params', () => {
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe(daysAgo(30));
    expect(result.current.to).toBe(today());
  });

  it('reads from/to from URL params', () => {
    currentParams = new URLSearchParams('from=2026-01-01&to=2026-01-31');
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe('2026-01-01');
    expect(result.current.to).toBe('2026-01-31');
  });

  it('converts legacy period=7d to from/to', () => {
    currentParams = new URLSearchParams('period=7d');
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe(daysAgo(7));
    expect(result.current.to).toBe(today());
  });

  it('converts legacy period=90d to from/to', () => {
    currentParams = new URLSearchParams('period=90d');
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe(daysAgo(90));
    expect(result.current.to).toBe(today());
  });

  it('converts legacy period=today to same-day range', () => {
    currentParams = new URLSearchParams('period=today');
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe(today());
    expect(result.current.to).toBe(today());
  });

  it('prefers from/to over period when both present', () => {
    currentParams = new URLSearchParams('from=2026-02-01&to=2026-02-15&period=7d');
    const { result } = renderHook(() => useDateRange());
    expect(result.current.from).toBe('2026-02-01');
    expect(result.current.to).toBe('2026-02-15');
  });

  it('setRange pushes new from/to params and removes period', () => {
    currentParams = new URLSearchParams('period=7d&user=abc');
    const { result } = renderHook(() => useDateRange('/statistics'));

    act(() => {
      result.current.setRange('2026-03-01', '2026-03-15');
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const pushed = mockPush.mock.calls[0]?.[0] as string;
    expect(pushed).toContain('/statistics?');
    expect(pushed).toContain('from=2026-03-01');
    expect(pushed).toContain('to=2026-03-15');
    expect(pushed).not.toContain('period=');
    expect(pushed).toContain('user=abc');
  });

  it('setRange preserves existing non-date params', () => {
    currentParams = new URLSearchParams('from=2026-01-01&to=2026-01-31&user=xyz&threshold=60');
    const { result } = renderHook(() => useDateRange('/statistics'));

    act(() => {
      result.current.setRange('2026-02-01', '2026-02-28');
    });

    const pushed = mockPush.mock.calls[0]?.[0] as string;
    expect(pushed).toContain('user=xyz');
    expect(pushed).toContain('threshold=60');
    expect(pushed).toContain('from=2026-02-01');
    expect(pushed).toContain('to=2026-02-28');
  });
});

describe('parseDateRangeParams', () => {
  it('returns from/to when both provided', () => {
    const result = parseDateRangeParams({ from: '2026-01-01', to: '2026-01-31' });
    expect(result).toEqual({ from: '2026-01-01', to: '2026-01-31', compare: false });
  });

  it('converts period to from/to', () => {
    const result = parseDateRangeParams({ period: '7d' });
    expect(result.from).toBe(daysAgo(7));
    expect(result.to).toBe(today());
    expect(result.compare).toBe(false);
  });

  it('returns 30-day default when no params', () => {
    const result = parseDateRangeParams({});
    expect(result.from).toBe(daysAgo(30));
    expect(result.to).toBe(today());
    expect(result.compare).toBe(false);
  });

  it('prefers from/to over period', () => {
    const result = parseDateRangeParams({ from: '2026-02-01', to: '2026-02-15', period: '90d' });
    expect(result).toEqual({ from: '2026-02-01', to: '2026-02-15', compare: false });
  });

  it('falls back to default when only from is provided', () => {
    const result = parseDateRangeParams({ from: '2026-01-01' });
    expect(result.from).toBe(daysAgo(30));
    expect(result.to).toBe(today());
    expect(result.compare).toBe(false);
  });

  it('parses compare=true from params', () => {
    const result = parseDateRangeParams({ from: '2026-01-01', to: '2026-01-31', compare: 'true' });
    expect(result.compare).toBe(true);
  });
});

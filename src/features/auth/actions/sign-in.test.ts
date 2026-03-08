import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseAuth, resetMocks } from '@tests/mocks/supabase';

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' }))),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, remaining: 5, limit: 5 })),
  resetRateLimit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import { signIn } from './sign-in';

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

describe('signIn', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should return success when login succeeds', async () => {
    mockSupabaseAuth.signInWithPassword.mockResolvedValue({
      data: { session: {} },
      error: null,
    });

    const result = await signIn(makeFormData({ email: 'joao@test.com', password: '12345678' }));

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'joao@test.com',
      password: '12345678',
    });
  });

  it('should return error for invalid credentials', async () => {
    mockSupabaseAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
    });

    const result = await signIn(makeFormData({ email: 'joao@test.com', password: 'wrong' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid login credentials');
    }
  });

  it('should return validation error for missing email', async () => {
    const result = await signIn(makeFormData({ email: '', password: '12345678' }));

    expect(result.success).toBe(false);
    expect(mockSupabaseAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

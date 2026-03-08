import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseAuth, resetMocks } from '@tests/mocks/supabase';

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' }))),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, remaining: 3, limit: 3 })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import { signUp } from './sign-up';

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

describe('signUp', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should return success when signup succeeds', async () => {
    mockSupabaseAuth.signUp.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const result = await signUp(
      makeFormData({ name: 'João Silva', email: 'joao@test.com', password: '12345678' }),
    );

    expect(result).toEqual({ success: true, data: { userId: 'user-123' } });
    expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
      email: 'joao@test.com',
      password: '12345678',
      options: { data: { full_name: 'João Silva' } },
    });
  });

  it('should return error for invalid email', async () => {
    const result = await signUp(
      makeFormData({ name: 'João', email: 'invalid', password: '12345678' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
    expect(mockSupabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it('should return error for short password', async () => {
    const result = await signUp(
      makeFormData({ name: 'João', email: 'joao@test.com', password: '123' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('8 caracteres');
    }
  });

  it('should return error when supabase returns error', async () => {
    mockSupabaseAuth.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered', code: 'user_exists' },
    });

    const result = await signUp(
      makeFormData({ name: 'João', email: 'joao@test.com', password: '12345678' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('User already registered');
      expect(result.code).toBe('user_exists');
    }
  });
});

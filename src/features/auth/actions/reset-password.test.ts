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

import { resetPassword } from './reset-password';

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

describe('resetPassword', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should return success when reset email is sent', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({ error: null });

    const result = await resetPassword(makeFormData({ email: 'joao@test.com' }));

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSupabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith('joao@test.com', {
      redirectTo: expect.any(String),
    });
  });

  it('should return error for invalid email', async () => {
    const result = await resetPassword(makeFormData({ email: 'invalid' }));

    expect(result.success).toBe(false);
    expect(mockSupabaseAuth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('should return error when supabase fails', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Rate limit exceeded', code: 'rate_limit' },
    });

    const result = await resetPassword(makeFormData({ email: 'joao@test.com' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Rate limit exceeded');
    }
  });
});

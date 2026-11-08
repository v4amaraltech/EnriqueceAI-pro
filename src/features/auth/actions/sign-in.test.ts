import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseAuth, resetMocks } from '@tests/mocks/supabase';

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' }))),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, remaining: 5, limit: 5 })),
  resetRateLimit: vi.fn(() => Promise.resolve()),
}));

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }));

const findPendingInviteByEmail = vi.fn();
vi.mock('../services/pending-invite', () => ({
  findPendingInviteByEmail: (...a: unknown[]) => findPendingInviteByEmail(...a),
}));
const resendInviteByEmail = vi.fn();
vi.mock('./resend-invite-by-email', () => ({
  resendInviteByEmail: (...a: unknown[]) => resendInviteByEmail(...a),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import { checkRateLimit, resetRateLimit } from '@/lib/security/rate-limit';

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
    findPendingInviteByEmail.mockReset();
    resendInviteByEmail.mockReset();
    vi.mocked(checkRateLimit).mockClear();
    vi.mocked(resetRateLimit).mockClear();
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

  it('pista 32: convite pendente recebe a mesma resposta que e-mail inexistente e o convite é reenviado por e-mail', async () => {
    mockSupabaseAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
    });
    findPendingInviteByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce({ memberId: 'm1' });

    const comum = await signIn(makeFormData({ email: 'x@test.com', password: 'wrong' }));
    const convidado = await signIn(makeFormData({ email: 'convidado@test.com', password: 'wrong' }));

    expect(convidado).toEqual(comum);
    expect(convidado).toMatchObject({ code: 'invalid_credentials' });
    expect(resendInviteByEmail).toHaveBeenCalledTimes(1);
    expect(resendInviteByEmail).toHaveBeenCalledWith('convidado@test.com');
  });

  it('pista 31: limita por e-mail além do IP e não zera o contador do IP no sucesso', async () => {
    mockSupabaseAuth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    await signIn(makeFormData({ email: 'Joao@Test.com', password: '12345678' }));

    const keys = vi.mocked(checkRateLimit).mock.calls.map((c) => c[0]);
    expect(keys).toEqual(['login-ip:127.0.0.1', 'login:127.0.0.1:joao@test.com', 'login-email:joao@test.com']);
    const reset = vi.mocked(resetRateLimit).mock.calls.map((c) => c[0]);
    expect(reset).toEqual(['login:127.0.0.1:joao@test.com', 'login-email:joao@test.com']);
  });

  it('pista 31: bloqueia quando o limite por e-mail estoura mesmo com IP novo', async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, remaining: 1, limit: 30 })
      .mockResolvedValueOnce({ allowed: true, remaining: 1, limit: 5 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 10, retryAfterMs: 60000 });
    const r = await signIn(makeFormData({ email: 'alvo@test.com', password: 'x1234567' }));
    expect(r).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(mockSupabaseAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

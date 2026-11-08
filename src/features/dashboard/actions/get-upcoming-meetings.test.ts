import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, resetMocks } from '@tests/mocks/supabase';

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

const mockRequireAuthWithMember = vi.fn();
vi.mock('@/lib/auth/require-auth-with-member', () => ({
  requireAuthWithMember: (...args: unknown[]) => mockRequireAuthWithMember(...args),
}));

const mockFetch = vi.fn();
vi.mock('../services/upcoming-meetings.service', () => ({
  fetchUpcomingMeetings: (...args: unknown[]) => mockFetch(...args),
}));

import { getUpcomingMeetings } from './get-upcoming-meetings';

const SDR = '11111111-1111-4111-8111-111111111111';

describe('getUpcomingMeetings', () => {
  beforeEach(() => {
    resetMocks();
    mockFetch.mockReset();
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'u-1', orgId: 'org-42', role: 'sdr' });
  });

  it('busca a janela com o filtro de vendedor da página', async () => {
    const payload = { days: [] };
    mockFetch.mockResolvedValue(payload);

    const result = await getUpcomingMeetings({ userIds: [SDR], startDate: '2026-11-08' });

    expect(result).toEqual({ success: true, data: payload });
    expect(mockFetch).toHaveBeenCalledWith(mockSupabase, 'org-42', { userIds: [SDR] }, '2026-11-08');
  });

  it.each([
    { userIds: [], startDate: '08/11/2026' },
    { userIds: [], startDate: '2026-11-8' },
    { userIds: ['nope'], startDate: '2026-11-08' },
  ])('rejeita entrada inválida %o', async (input) => {
    expect(await getUpcomingMeetings(input)).toEqual({ success: false, error: 'Parâmetros inválidos' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('erro do banco vira mensagem amigável', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('boom'));
    expect(await getUpcomingMeetings({ userIds: [], startDate: '2026-11-08' })).toEqual({
      success: false,
      error: 'Erro ao buscar as reuniões futuras',
    });
  });

  it('propaga redirect de auth', async () => {
    mockRequireAuthWithMember.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(getUpcomingMeetings({ userIds: [], startDate: '2026-11-08' })).rejects.toThrow('NEXT_REDIRECT');
  });
});

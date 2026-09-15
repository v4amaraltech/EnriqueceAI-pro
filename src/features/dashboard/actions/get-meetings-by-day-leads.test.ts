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
vi.mock('../services/meetings-by-day-leads.service', () => ({
  fetchMeetingsByDayLeads: (...args: unknown[]) => mockFetch(...args),
}));

import { getMeetingsByDayLeads } from './get-meetings-by-day-leads';

const filters = { month: '2026-09', cadenceIds: [] as string[], userIds: [] as string[] };

describe('getMeetingsByDayLeads', () => {
  beforeEach(() => {
    resetMocks();
    mockFetch.mockReset();
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'u-1', orgId: 'org-42', role: 'sdr' });
  });

  it('devolve os leads do dia com os filtros da página', async () => {
    const payload = { scheduled: [], held: [] };
    mockFetch.mockResolvedValue(payload);

    const result = await getMeetingsByDayLeads({ filters, day: 14 });

    expect(result).toEqual({ success: true, data: payload });
    expect(mockFetch).toHaveBeenCalledWith(mockSupabase, 'org-42', filters, 14);
  });

  it.each([0, 32, 1.5])('rejeita day inválido (%s)', async (day) => {
    const result = await getMeetingsByDayLeads({ filters, day });
    expect(result).toEqual({ success: false, error: 'Parâmetros inválidos' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejeita filtros inválidos (uuid ruim / mês fora do formato)', async () => {
    expect(await getMeetingsByDayLeads({ filters: { ...filters, userIds: ['nope'] }, day: 1 })).toEqual({
      success: false,
      error: 'Parâmetros inválidos',
    });
    expect(await getMeetingsByDayLeads({ filters: { ...filters, month: '2026-9' }, day: 1 })).toEqual({
      success: false,
      error: 'Parâmetros inválidos',
    });
  });

  it('propaga redirect de auth', async () => {
    mockRequireAuthWithMember.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(getMeetingsByDayLeads({ filters, day: 1 })).rejects.toThrow('NEXT_REDIRECT');
  });

  it('retorna erro amigável quando o serviço falha', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('boom'));
    const result = await getMeetingsByDayLeads({ filters, day: 1 });
    expect(result).toEqual({ success: false, error: 'Erro ao buscar os leads do dia' });
    spy.mockRestore();
  });
});

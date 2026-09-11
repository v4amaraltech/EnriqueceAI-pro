import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/auth/require-manager', () => ({
  requireManager: vi.fn(() =>
    Promise.resolve({ id: 'user-1', email: 'manager@test.com' }),
  ),
}));

import { saveGoals } from './save-goals';

function createChainMock(finalResult: unknown = { data: null, error: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => Promise.resolve(finalResult)),
    upsert: vi.fn().mockImplementation(() => Promise.resolve({ error: null })),
  };
}

const validInput = {
  month: '2026-02',
  opportunityTarget: 50,
  leadsFinishedTarget: 100,
  activitiesTarget: 200,
  conversionTarget: 25,
  leadsOpenedTarget: 150,
  meetingsScheduledTarget: 100,
  meetingsHeldTarget: 80,
  userGoals: [
    { userId: '00000000-0000-0000-0000-000000000001', leadsOpenedTarget: 20 },
  ],
};

describe('saveGoals', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns error for invalid input', async () => {
    const result = await saveGoals({ ...validInput, month: 'bad' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain('YYYY-MM');
  });

  it('returns error when org not found', async () => {
    const chain = createChainMock({ data: null });
    mockFrom.mockReturnValue(chain);

    const result = await saveGoals(validInput);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBe('Organização não encontrada');
  });

  it('upserts goals and goals_per_user on success', async () => {
    const orgChain = createChainMock({ data: { org_id: 'org-1' } });
    const goalsChain = createChainMock();
    const userGoalsChain = createChainMock();

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return orgChain;
      if (callCount === 2) return goalsChain;
      return userGoalsChain;
    });

    const result = await saveGoals(validInput);
    expect(result.success).toBe(true);
    expect(goalsChain.upsert).toHaveBeenCalledTimes(1);
    expect(userGoalsChain.upsert).toHaveBeenCalledTimes(1);
  });

  it('grava as metas de ligações por SDR (0 quando o cliente não envia)', async () => {
    const orgChain = createChainMock({ data: { org_id: 'org-1' } });
    const goalsChain = createChainMock();
    const userGoalsChain = createChainMock();

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return orgChain;
      if (callCount === 2) return goalsChain;
      return userGoalsChain;
    });

    await saveGoals({
      ...validInput,
      userGoals: [
        { userId: '00000000-0000-0000-0000-000000000001', callsTarget: 2200, callsConnectedTarget: 176 },
        { userId: '00000000-0000-0000-0000-000000000002' },
      ],
    });

    const rows = (userGoalsChain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ calls_target: 2200, calls_connected_target: 176 });
    expect(rows[1]).toMatchObject({ calls_target: 0, calls_connected_target: 0 });
  });

  it('returns error when goals upsert fails', async () => {
    const orgChain = createChainMock({ data: { org_id: 'org-1' } });
    const goalsChain = {
      ...createChainMock(),
      upsert: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return orgChain;
      return goalsChain;
    });

    const result = await saveGoals(validInput);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBe('Erro ao salvar meta da organização');
  });

  it('returns error when user goals upsert fails', async () => {
    const orgChain = createChainMock({ data: { org_id: 'org-1' } });
    const goalsChain = createChainMock();
    const userGoalsChain = {
      ...createChainMock(),
      upsert: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return orgChain;
      if (callCount === 2) return goalsChain;
      return userGoalsChain;
    });

    const result = await saveGoals(validInput);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBe('Erro ao salvar metas individuais');
  });
});

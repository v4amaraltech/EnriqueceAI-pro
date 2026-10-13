import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTemplates } from './fetch-templates';

const chain: Record<string, ReturnType<typeof vi.fn>> = {};
for (const m of ['select', 'eq', 'not', 'or', 'order', 'range'])
  chain[m] = vi.fn().mockReturnValue(chain);
chain.then = vi.fn((resolve) => resolve({ data: [], count: 0, error: null }));

vi.mock('@/lib/auth/require-auth-with-member', () => ({
  requireAuthWithMember: vi.fn(async () => ({ userId: 'u-1', orgId: 'org-1', role: 'sdr' })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from: () => chain })),
}));

describe('fetchTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('esconde os templates internos "Auto Email - Step N"', async () => {
    await fetchTemplates();
    expect(chain.not).toHaveBeenCalledWith('name', 'like', 'Auto Email - Step %');
  });

  it('não filtra por quem criou (todos da org veem todos)', async () => {
    await fetchTemplates();
    expect(chain.or).not.toHaveBeenCalled();
  });
});

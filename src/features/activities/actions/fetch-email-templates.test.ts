import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchEmailTemplates } from './fetch-email-templates';

const rows = [
  { id: 't-auto-1', name: 'Auto Email - Step 1', subject: 'a', body: 'a' },
  { id: 't-auto-2', name: 'Auto Email - Step 2 (B)', subject: 'b', body: 'b' },
  { id: 't-human', name: '1º E-mail [REATIVAÇÃO].', subject: 'c', body: 'c' },
];

const chain: Record<string, ReturnType<typeof vi.fn>> = {};
for (const m of ['select', 'eq', 'order']) chain[m] = vi.fn().mockReturnValue(chain);
chain.then = vi.fn((resolve) => resolve({ data: rows, error: null }));

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(async () => ({
    success: true,
    data: { orgId: 'org-1', supabase: { from: () => chain } },
  })),
}));

describe('fetchEmailTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('esconde os templates internos da cadência automática', async () => {
    const result = await fetchEmailTemplates();
    expect(result.success && result.data.map((t) => t.id)).toEqual(['t-human']);
  });

  it('mantém o template da própria etapa mesmo se for interno', async () => {
    const result = await fetchEmailTemplates('t-auto-1');
    expect(result.success && result.data.map((t) => t.id)).toEqual(['t-auto-1', 't-human']);
  });
});

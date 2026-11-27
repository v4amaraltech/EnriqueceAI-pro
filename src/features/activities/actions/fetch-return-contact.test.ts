import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCallbackTarget } from '@/features/cockpit/services/callback-contact.service';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { fetchReturnContact } from './fetch-return-contact';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/features/cockpit/services/callback-contact.service', () => ({
  loadCallbackTarget: vi.fn(),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
let lead: { id: string } | null;
const chain: Record<string, unknown> = {};
for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
chain.maybeSingle = vi.fn(async () => ({ data: lead }));

beforeEach(() => {
  vi.clearAllMocks();
  lead = { id: LEAD };
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({
    success: true,
    data: { orgId: 'org-1', userId: 'u', supabase: { from: () => chain } },
  } as never);
  vi.mocked(loadCallbackTarget).mockResolvedValue(null);
});

describe('fetchReturnContact', () => {
  it('usa a regra da discagem para ESTA tarefa, com o org da sessão', async () => {
    expect(await fetchReturnContact({ scheduledActivityId: ID, leadId: LEAD })).toEqual({
      success: true,
      data: null,
    });
    expect(loadCallbackTarget).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', leadId: LEAD, returnId: ID }),
    );
  });

  it('lead que a sessão não vê, ou id inválido: não consulta a regra', async () => {
    lead = null;
    expect(await fetchReturnContact({ scheduledActivityId: ID, leadId: LEAD })).toMatchObject({
      success: false,
    });
    expect(await fetchReturnContact({ scheduledActivityId: 'x', leadId: LEAD })).toMatchObject({
      success: false,
    });
    expect(loadCallbackTarget).not.toHaveBeenCalled();
  });

  it('falha de leitura dentro da regra vira success: false (diferente de "sem contato")', async () => {
    vi.mocked(loadCallbackTarget).mockImplementation(async (input) => {
      input.onError?.();
      return null;
    });
    expect(await fetchReturnContact({ scheduledActivityId: ID, leadId: LEAD })).toMatchObject({
      success: false,
    });
  });
});

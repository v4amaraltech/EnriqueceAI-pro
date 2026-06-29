import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let cadenceChain: ReturnType<typeof createChainMock>;
let stepsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'cadences') return cadenceChain;
        if (table === 'cadence_steps') return stepsChain;
        return createChainMock();
      },
    });
  }),
}));

import { saveTimelineSteps } from './save-timeline-steps';

describe('saveTimelineSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    cadenceChain = createChainMock();
    stepsChain = createChainMock();
  });

  it('should return error when user has no org', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });

    const result = await saveTimelineSteps('cad-1', []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when cadence not found', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (cadenceChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });

    const result = await saveTimelineSteps('cad-999', []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Cadência não encontrada');
    }
  });

  it('should return error when cadence is active', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (cadenceChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'cad-1', status: 'active' } });

    const result = await saveTimelineSteps('cad-1', [{ channel: 'email', delay_days: 0, step_order: 1 }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('rascunho ou pausada');
    }
  });

  it('should save steps successfully for draft cadence', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (cadenceChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'cad-1', status: 'draft' } });
    (stepsChain.delete as ReturnType<typeof vi.fn>).mockReturnValue(stepsChain);
    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (stepsChain.insert as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (cadenceChain.update as ReturnType<typeof vi.fn>).mockReturnValue(cadenceChain);

    const steps = [
      { channel: 'email' as const, delay_days: 0, step_order: 1 },
      { channel: 'phone' as const, delay_days: 1, step_order: 2 },
    ];

    const result = await saveTimelineSteps('cad-1', steps);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saved).toBe(2);
    }
  });

  it('should persist call_provider on WhatsApp-call steps and null otherwise', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (cadenceChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'cad-1', status: 'draft' } });
    (stepsChain.delete as ReturnType<typeof vi.fn>).mockReturnValue(stepsChain);
    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (stepsChain.insert as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (cadenceChain.update as ReturnType<typeof vi.fn>).mockReturnValue(cadenceChain);

    const steps = [
      { channel: 'phone' as const, delay_days: 0, step_order: 1, call_provider: 'whatsapp' as const },
      { channel: 'phone' as const, delay_days: 0, step_order: 2 },
    ];

    const result = await saveTimelineSteps('cad-1', steps);
    expect(result.success).toBe(true);

    const insertArg = (stepsChain.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(insertArg[0]?.call_provider).toBe('whatsapp');
    expect(insertArg[1]?.call_provider).toBeNull();
  });

  it('should save empty steps (clear all) for draft cadence', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (cadenceChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'cad-1', status: 'draft' } });
    (stepsChain.delete as ReturnType<typeof vi.fn>).mockReturnValue(stepsChain);
    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    (cadenceChain.update as ReturnType<typeof vi.fn>).mockReturnValue(cadenceChain);

    const result = await saveTimelineSteps('cad-1', []);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saved).toBe(0);
    }
  });
});

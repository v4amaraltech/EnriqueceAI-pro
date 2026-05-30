import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let lossReasonsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'loss_reasons') return lossReasonsChain;
        return createChainMock();
      },
    });
  }),
}));

import {
  addLossReason,
  deleteLossReason,
  listLossReasons,
  updateLossReason,
} from './loss-reasons-crud';

describe('loss-reasons-crud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    lossReasonsChain = createChainMock();

    // Default: org found
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
  });

  describe('listLossReasons', () => {
    it('should return error when org not found', async () => {
      (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      const result = await listLossReasons();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Organização não encontrada');
    });

    it('should seed defaults when no reasons exist and return them', async () => {
      // First call: check existing (empty)
      (lossReasonsChain.limit as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], error: null });
      // After seed: return seeded data
      (lossReasonsChain.order as ReturnType<typeof vi.fn>).mockReturnValue({
        order: vi.fn().mockReturnValue({
          data: [
            { id: 'r-1', org_id: 'org-1', name: 'Sem interesse', is_system: true, sort_order: 1, created_at: '2026-01-01' },
          ],
          error: null,
        }),
      });
      const result = await listLossReasons();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
        expect(result.data[0]!.name).toBe('Sem interesse');
      }
    });

    it('should return existing reasons without seeding', async () => {
      (lossReasonsChain.limit as ReturnType<typeof vi.fn>).mockReturnValue({
        data: [{ id: 'r-1' }],
        error: null,
      });
      (lossReasonsChain.order as ReturnType<typeof vi.fn>).mockReturnValue({
        order: vi.fn().mockReturnValue({
          data: [
            { id: 'r-1', org_id: 'org-1', name: 'Custom', is_system: false, sort_order: 1, created_at: '2026-01-01' },
          ],
          error: null,
        }),
      });
      const result = await listLossReasons();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0]!.name).toBe('Custom');
      }
    });
  });

  describe('addLossReason', () => {
    it('should return error for empty name', async () => {
      const result = await addLossReason('  ');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Nome é obrigatório');
    });

    it('should return error when org not found', async () => {
      (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      const result = await addLossReason('Test');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Organização não encontrada');
    });

    it('should add a reason successfully', async () => {
      (lossReasonsChain.single as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ data: { sort_order: 3 } }) // max sort_order
        .mockReturnValueOnce({
          data: { id: 'r-new', org_id: 'org-1', name: 'New Reason', is_system: false, sort_order: 4, created_at: '2026-01-01' },
          error: null,
        });
      const result = await addLossReason('New Reason');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe('New Reason');
    });
  });

  describe('updateLossReason', () => {
    const validId = '00000000-0000-0000-0000-000000000001';

    it('should return error for empty name', async () => {
      const result = await updateLossReason(validId, '');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Nome é obrigatório');
    });

    it('should update name successfully', async () => {
      (lossReasonsChain.single as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { id: validId, org_id: 'org-1', name: 'Updated', is_system: false, sort_order: 1, created_at: '2026-01-01' },
        error: null,
      });
      const result = await updateLossReason(validId, 'Updated');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe('Updated');
    });
  });

  describe('deleteLossReason', () => {
    const validId = '00000000-0000-0000-0000-000000000001';

    it('should return error when org not found', async () => {
      (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      const result = await deleteLossReason(validId);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Organização não encontrada');
    });

    it('should block deletion of system reasons', async () => {
      (lossReasonsChain.single as ReturnType<typeof vi.fn>).mockReturnValue({ data: { is_system: true } });
      const result = await deleteLossReason(validId);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Motivos padrão não podem ser removidos');
    });

    it('should delete non-system reason', async () => {
      // First chain call: select is_system check
      (lossReasonsChain.single as ReturnType<typeof vi.fn>).mockReturnValue({ data: { is_system: false } });
      // Second chain call: delete — eq returns chain-like object with no error
      const deleteChain = createChainMock();
      Object.assign(deleteChain, { error: null });
      (lossReasonsChain.delete as ReturnType<typeof vi.fn>).mockReturnValue(deleteChain);
      const result = await deleteLossReason(validId);
      expect(result.success).toBe(true);
    });
  });
});

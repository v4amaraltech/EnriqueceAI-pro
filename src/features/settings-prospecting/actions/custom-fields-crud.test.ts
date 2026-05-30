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
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let customFieldsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'custom_fields') return customFieldsChain;
        return createChainMock();
      },
    });
  }),
}));

import { addCustomField, deleteCustomField, listCustomFields, updateCustomField } from './custom-fields-crud';

describe('custom-fields-crud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    customFieldsChain = createChainMock();

    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
  });

  describe('listCustomFields', () => {
    it('should return error when org not found', async () => {
      (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      const result = await listCustomFields();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Organização não encontrada');
    });

    it('should return empty array when no fields', async () => {
      Object.assign(customFieldsChain, { data: [], error: null });
      const result = await listCustomFields();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });
  });

  describe('addCustomField', () => {
    it('should reject empty name', async () => {
      const result = await addCustomField('', 'text');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Nome do campo é obrigatório');
    });

    it('should reject select without options', async () => {
      const result = await addCustomField('Segmento', 'select', []);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('pelo menos uma opção');
    });

    it('should add valid field', async () => {
      (customFieldsChain.single as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { sort_order: 2 } })
        .mockResolvedValueOnce({ data: { id: 'f-1', org_id: 'org-1', field_name: 'Cargo', field_type: 'text', options: null, sort_order: 3, created_at: '2026-01-01' } });
      const result = await addCustomField('Cargo', 'text');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.field_name).toBe('Cargo');
    });
  });

  describe('updateCustomField', () => {
    it('should reject empty name', async () => {
      const result = await updateCustomField('f-1', '  ', 'text');
      expect(result.success).toBe(false);
    });

    it('should update field', async () => {
      const validId = '00000000-0000-0000-0000-000000000001';
      (customFieldsChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: validId, org_id: 'org-1', field_name: 'Segmento', field_type: 'select', options: ['A', 'B'], sort_order: 1, created_at: '2026-01-01' },
      });
      const result = await updateCustomField(validId, 'Segmento', 'select', ['A', 'B']);
      expect(result.success).toBe(true);
    });
  });

  describe('deleteCustomField', () => {
    it('should delete field', async () => {
      const validId = '00000000-0000-0000-0000-000000000001';
      Object.assign(customFieldsChain, { error: null });
      const result = await deleteCustomField(validId);
      expect(result.success).toBe(true);
    });
  });
});

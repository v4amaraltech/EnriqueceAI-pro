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
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let settingsChain: ReturnType<typeof createChainMock>;
let targetsChain: ReturnType<typeof createChainMock>;
let blacklistChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'organization_call_settings') return settingsChain;
        if (table === 'call_daily_targets') return targetsChain;
        if (table === 'phone_blacklist') return blacklistChain;
        return createChainMock();
      },
    });
  }),
}));

import {
  addPhoneBlacklist,
  deletePhoneBlacklist,
  getCallSettings,
  saveCallSettings,
} from './call-settings-crud';

describe('call-settings-crud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    settingsChain = createChainMock();
    targetsChain = createChainMock();
    blacklistChain = createChainMock();

    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { org_id: 'org-1' },
    });
  });

  describe('getCallSettings', () => {
    it('should return error when org not found', async () => {
      (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      const result = await getCallSettings();
      expect(result.success).toBe(false);
    });

    it('should return settings data', async () => {
      (settingsChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: 's1', calls_enabled: true },
      });
      Object.assign(targetsChain, {
        then: (cb: (v: unknown) => unknown) =>
          cb({ data: [] }),
      });
      Object.assign(blacklistChain, {
        then: (cb: (v: unknown) => unknown) =>
          cb({ data: [] }),
      });

      const result = await getCallSettings();
      expect(result.success).toBe(true);
    });
  });

  describe('saveCallSettings', () => {
    it('should reject invalid input', async () => {
      const result = await saveCallSettings({ calls_enabled: 'not-a-boolean' });
      expect(result.success).toBe(false);
    });

    it('should create settings when none exist', async () => {
      (settingsChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
      Object.assign(settingsChain, { error: null });

      const result = await saveCallSettings({
        calls_enabled: true,
        default_call_type: 'outbound',
        significant_threshold_seconds: 30,
        daily_call_target: 20,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('addPhoneBlacklist', () => {
    it('should reject empty pattern', async () => {
      const result = await addPhoneBlacklist({ phone_pattern: '' });
      expect(result.success).toBe(false);
    });

    it('should add valid phone pattern', async () => {
      (blacklistChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: 'b-1', org_id: 'org-1', phone_pattern: '+5511*', reason: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
      });

      const result = await addPhoneBlacklist({ phone_pattern: '+5511*' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone_pattern).toBe('+5511*');
    });
  });

  describe('deletePhoneBlacklist', () => {
    it('should delete phone pattern', async () => {
      Object.assign(blacklistChain, { error: null });
      const result = await deletePhoneBlacklist('550e8400-e29b-41d4-a716-446655440000');
      expect(result.success).toBe(true);
    });

    it('should reject invalid id', async () => {
      const result = await deletePhoneBlacklist('b-1');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ID inválido');
    });
  });
});

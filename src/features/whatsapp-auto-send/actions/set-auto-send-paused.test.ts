import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase, eqValue, type RecordedQuery } from '../services/test-helpers';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/user-directory', () => ({
  resolveUserProfiles: vi.fn(() => Promise.resolve(new Map([['sdr-a', { displayName: 'Ana' }]]))),
}));
let fake: ReturnType<typeof createFakeSupabase>;
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => fake.client }));

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { setAutoSendPaused } from './set-auto-send-paused';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';

function asUser(userId: string, role: 'sdr' | 'manager') {
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({
    success: true,
    data: { userId, role, orgId: 'org-1', supabase: {} as never },
  });
}

function withInstance(instance: Record<string, unknown> | null) {
  fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.table === 'whatsapp_instances' && q.op === 'select') return { data: instance };
    return {};
  });
}

const updates = () =>
  fake.queries.filter((q) => q.table === 'whatsapp_instances' && q.op === 'update').map((q) => q.payload as Record<string, unknown>);

beforeEach(() => vi.clearAllMocks());

describe('setAutoSendPaused', () => {
  const own = { id: INSTANCE_ID, org_id: 'org-1', user_id: 'sdr-a', status: 'connected', auto_send_paused_at: null };

  it('SDR pausa o próprio número (critério 12)', async () => {
    asUser('sdr-a', 'sdr');
    withInstance(own);
    const r = await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: true });
    expect(r).toEqual({ success: true, data: { paused: true } });
    expect(updates()[0]).toMatchObject({ auto_send_pause_reason: 'pausado manualmente por Ana' });
    expect(updates()[0]?.auto_send_paused_at).toEqual(expect.any(String));
  });

  it('SDR não altera o número de outro SDR (critério 14)', async () => {
    asUser('sdr-b', 'sdr');
    withInstance(own);
    const r = await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: true });
    expect(r).toEqual({ success: false, error: 'Número não encontrado' });
    expect(updates()).toEqual([]);
  });

  it('gestor retoma qualquer número do time e zera o freio (critério 13)', async () => {
    asUser('mgr', 'manager');
    withInstance({ ...own, auto_send_paused_at: '2026-11-09T12:00:00Z' });
    const r = await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: false });
    expect(r).toEqual({ success: true, data: { paused: false } });
    expect(updates()[0]).toEqual({
      auto_send_paused_at: null,
      auto_send_pause_reason: null,
      auto_send_consecutive_failures: 0,
      auto_send_next_at: null,
    });
  });

  it('busca o número só dentro da org do usuário', async () => {
    asUser('mgr', 'manager');
    withInstance(null);
    expect(await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: true })).toEqual({
      success: false,
      error: 'Número não encontrado',
    });
    expect(eqValue(fake.queries[0]!, 'org_id')).toBe('org-1');
  });

  it('não retoma com o WhatsApp desconectado', async () => {
    asUser('sdr-a', 'sdr');
    withInstance({ ...own, status: 'disconnected', auto_send_paused_at: '2026-11-09T12:00:00Z' });
    const r = await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: false });
    expect(r.success).toBe(false);
    expect(updates()).toEqual([]);
  });

  it('a instância padrão da organização (sem dono) não aparece nem para gestor', async () => {
    asUser('mgr', 'manager');
    withInstance({ ...own, user_id: null });
    expect((await setAutoSendPaused({ instanceId: INSTANCE_ID, paused: true })).success).toBe(false);
  });
});

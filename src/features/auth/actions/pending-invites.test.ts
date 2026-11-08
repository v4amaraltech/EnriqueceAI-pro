import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeClient, hasFilter, type Call } from '@tests/helpers/fake-supabase';

const log: Call[] = [];
const INVITE_ID = '22222222-2222-4222-8222-222222222222';

const state = {
  sessionUser: { id: 'U1', email: 'u1@test.invalid' } as { id: string; email: string } | null,
  invite: { id: INVITE_ID, org_id: 'ORG-M', user_id: 'U1', status: 'invited' } as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () =>
    Object.assign(fakeClient('user', log), { auth: { getUser: async () => ({ data: { user: state.sessionUser } }) } }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () =>
    fakeClient('service', log, (call, terminal) => {
      if (call.op === 'select') return terminal === 'maybeSingle' ? { data: state.invite } : { data: state.rows };
      return {};
    }),
}));

const memberWrites = () => log.filter((c) => c.table === 'organization_members' && c.op !== 'select');

beforeEach(() => {
  log.length = 0;
  state.sessionUser = { id: 'U1', email: 'u1@test.invalid' };
  state.invite = { id: INVITE_ID, org_id: 'ORG-M', user_id: 'U1', status: 'invited' };
  state.rows = [];
});

describe('listPendingOrgInvites', () => {
  it('filtra pelo user_id e pelo status invited', async () => {
    const { listPendingOrgInvites } = await import('../services/pending-org-invites');
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    await listPendingOrgInvites(createServiceRoleClient(), 'U1');
    const sel = log.find((c) => c.table === 'organization_members')!;
    expect(hasFilter(sel, 'user_id', 'U1')).toBe(true);
    expect(hasFilter(sel, 'status', 'invited')).toBe(true);
  });

  it('descarta expirados e mapeia o nome da org', async () => {
    const { listPendingOrgInvites } = await import('../services/pending-org-invites');
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    state.rows = [
      { id: 'a', org_id: 'O1', role: 'sdr', invited_at: null, invited_expires_at: '2020-01-01T00:00:00Z', organization: { name: 'Velha' } },
      { id: 'b', org_id: 'O2', role: 'manager', invited_at: null, invited_expires_at: null, organization: { name: 'Acme' } },
    ];
    const r = await listPendingOrgInvites(createServiceRoleClient(), 'U1');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'b', orgName: 'Acme', role: 'manager' });
  });

  it('sem userId retorna vazio sem consultar', async () => {
    const { listPendingOrgInvites } = await import('../services/pending-org-invites');
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    expect(await listPendingOrgInvites(createServiceRoleClient(), '')).toEqual([]);
    expect(log).toHaveLength(0);
  });
});

describe('fetchMyPendingOrgInvites', () => {
  it('exige autenticação', async () => {
    state.sessionUser = null;
    const { fetchMyPendingOrgInvites } = await import('./list-pending-org-invites');
    expect((await fetchMyPendingOrgInvites()).success).toBe(false);
    expect(log.some((c) => c.client === 'service')).toBe(false);
  });

  it('consulta usando o id da sessão', async () => {
    const { fetchMyPendingOrgInvites } = await import('./list-pending-org-invites');
    const r = await fetchMyPendingOrgInvites();
    expect(r.success).toBe(true);
    const sel = log.find((c) => c.client === 'service')!;
    expect(hasFilter(sel, 'user_id', 'U1')).toBe(true);
  });
});

describe('declineOrgInvite', () => {
  it('recusa o próprio convite: marca removed com filtros de posse', async () => {
    const { declineOrgInvite } = await import('./decline-org-invite');
    const r = await declineOrgInvite(INVITE_ID);
    expect(r).toEqual({ success: true, data: { orgId: 'ORG-M' } });
    const w = memberWrites();
    expect(w).toHaveLength(1);
    expect((w[0]!.payload as { status: string }).status).toBe('removed');
    expect(hasFilter(w[0]!, 'user_id', 'U1')).toBe(true);
    expect(hasFilter(w[0]!, 'status', 'invited')).toBe(true);
  });

  it('convite de outro usuário não é alterado', async () => {
    state.invite = { id: INVITE_ID, org_id: 'ORG-M', user_id: 'OUTRO', status: 'invited' };
    const { declineOrgInvite } = await import('./decline-org-invite');
    expect((await declineOrgInvite(INVITE_ID)).success).toBe(false);
    expect(memberWrites()).toHaveLength(0);
  });

  it('membro ativo não pode ser "recusado"', async () => {
    state.invite = { id: INVITE_ID, org_id: 'ORG-M', user_id: 'U1', status: 'active' };
    const { declineOrgInvite } = await import('./decline-org-invite');
    expect((await declineOrgInvite(INVITE_ID)).success).toBe(false);
    expect(memberWrites()).toHaveLength(0);
  });

  it('id inválido e não autenticado são recusados', async () => {
    const { declineOrgInvite } = await import('./decline-org-invite');
    expect((await declineOrgInvite('x')).success).toBe(false);
    state.sessionUser = null;
    expect((await declineOrgInvite(INVITE_ID)).success).toBe(false);
    expect(memberWrites()).toHaveLength(0);
  });
});

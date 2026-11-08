// Pistas 20 e 22 da auditoria: gerente não pode apagar a org solo de outro usuário
// nem ativá-lo à força. Quem já tem conta só entra por convite pendente que ele
// mesmo aceita autenticado.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeClient, hasFilter, type Call } from '@tests/helpers/fake-supabase';

const log: Call[] = [];

// Estado do cenário, ajustado por teste.
const state = {
  sessionUser: { id: 'VICTIM', email: 'vitima@test.invalid', user_metadata: {} as Record<string, unknown> } as {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
  } | null,
  invite: {
    id: '11111111-1111-4111-8111-111111111111',
    org_id: 'ORG-M',
    user_id: 'VICTIM',
    status: 'invited',
    invited_expires_at: null as string | null,
  } as Record<string, unknown> | null,
  activeOrgs: [{ org_id: 'ORG-V' }] as Array<{ org_id: string }>,
  orgOwner: 'VICTIM',
  activeCount: 1,
  leads: 0,
  cadences: 0,
};

const INVITE_ID = '11111111-1111-4111-8111-111111111111';

function memberResponder(c: Call, terminal?: 'single' | 'maybeSingle') {
  if (c.table === 'organization_members' && c.op === 'select') {
    if (terminal === 'maybeSingle') return { data: hasFilter(c, 'id') ? state.invite : null };
    if (hasFilter(c, 'status', 'invited')) return { data: state.invite ? [state.invite] : [] };
    if (terminal === 'single') return { data: state.activeOrgs[0] ? { id: 'AUTO-M', org_id: state.activeOrgs[0].org_id } : null };
    if (c.selectArgs && (c.selectArgs[1] as { head?: boolean } | undefined)?.head) return { count: state.activeCount };
    return { data: state.activeOrgs };
  }
  if (c.table === 'organizations' && c.op === 'select') return { data: { owner_id: state.orgOwner } };
  if (c.table === 'leads') return { count: state.leads };
  if (c.table === 'cadences') return { count: state.cadences };
  return {};
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: async () => undefined,
}));
vi.mock('@/lib/auth/require-manager', () => ({ requireManager: async () => ({ id: 'MGR-M' }) }));
vi.mock('@/features/auth/services/member-limits.service', () => ({
  checkMemberLimit: async () => ({ allowed: true, current: 1, max: 5 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => {
    const c = fakeClient('user', log, (call) =>
      call.table === 'organization_members' ? { data: { org_id: 'ORG-M' } } : {},
    );
    return Object.assign(c, { auth: { getUser: async () => ({ data: { user: state.sessionUser } }) } });
  },
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => fakeClient('service', log, memberResponder),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () =>
    fakeClient('admin', log, memberResponder, (name) => (name === 'find_user_id_by_email' ? 'VICTIM' : null)),
}));

const orgDeletes = () => log.filter((c) => c.table === 'organizations' && c.op === 'delete');
const memberWrites = () => log.filter((c) => c.table === 'organization_members' && c.op !== 'select');

beforeEach(() => {
  log.length = 0;
  state.sessionUser = { id: 'VICTIM', email: 'vitima@test.invalid', user_metadata: {} };
  state.invite = { id: INVITE_ID, org_id: 'ORG-M', user_id: 'VICTIM', status: 'invited', invited_expires_at: null };
  state.activeOrgs = [{ org_id: 'ORG-V' }];
  state.orgOwner = 'VICTIM';
  state.activeCount = 1;
  state.leads = 0;
  state.cadences = 0;
});

describe('pista 20: ataque do gerente falha', () => {
  it('convidar o e-mail da vítima NÃO apaga a org dela e NÃO a ativa', async () => {
    const { inviteMember } = await import('./invite-member');
    const fd = new FormData();
    fd.set('email', 'vitima@test.invalid');
    fd.set('role', 'sdr');
    const r = await inviteMember(fd);

    expect(r.success).toBe(true);
    expect(orgDeletes()).toHaveLength(0);
    const writes = memberWrites();
    expect(writes).toHaveLength(1);
    const payload = writes[0]!.payload as { org_id: string; user_id: string; status: string };
    expect(payload).toMatchObject({ org_id: 'ORG-M', user_id: 'VICTIM', status: 'invited' });
    // nenhuma escrita deixa a vítima 'active' na org do atacante
    expect(writes.some((w) => (w.payload as { status?: string }).status === 'active')).toBe(false);
  });

  it('mesmo com a org da vítima cheia de dados, nada é apagado nem movido', async () => {
    state.leads = 50;
    const { inviteMember } = await import('./invite-member');
    const fd = new FormData();
    fd.set('email', 'vitima@test.invalid');
    fd.set('role', 'manager');
    await inviteMember(fd);
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites().every((w) => (w.payload as { status?: string }).status === 'invited')).toBe(true);
  });
});

describe('acceptOrgInvite (aceite explícito pelo próprio usuário)', () => {
  it('usuário autenticado aceita o próprio convite: org solo VAZIA é substituída e o membro fica active', async () => {
    const { acceptOrgInvite } = await import('./accept-org-invite');
    const r = await acceptOrgInvite(INVITE_ID);

    expect(r).toEqual({ success: true, data: { orgId: 'ORG-M' } });
    const del = orgDeletes();
    expect(del).toHaveLength(1);
    expect(hasFilter(del[0]!, 'id', 'ORG-V')).toBe(true);
    const upd = memberWrites().find((c) => c.op === 'update')!;
    expect((upd.payload as { status: string }).status).toBe('active');
    expect(hasFilter(upd, 'user_id', 'VICTIM')).toBe(true);
    expect(upd.client).toBe('service');
  });

  it('org atual com leads NÃO é apagada: aceite é recusado', async () => {
    state.leads = 3;
    const { acceptOrgInvite } = await import('./accept-org-invite');
    const r = await acceptOrgInvite(INVITE_ID);
    expect(r.success).toBe(false);
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites()).toHaveLength(0);
  });

  it('org atual com outros membros NÃO é apagada', async () => {
    state.activeCount = 3;
    const { acceptOrgInvite } = await import('./accept-org-invite');
    const r = await acceptOrgInvite(INVITE_ID);
    expect(r.success).toBe(false);
    expect(orgDeletes()).toHaveLength(0);
  });

  it('org atual onde o usuário não é dono NÃO é apagada', async () => {
    state.orgOwner = 'OUTRO';
    const { acceptOrgInvite } = await import('./accept-org-invite');
    const r = await acceptOrgInvite(INVITE_ID);
    expect(r.success).toBe(false);
    expect(orgDeletes()).toHaveLength(0);
  });

  it('terceiro não aceita convite alheio', async () => {
    state.sessionUser = { id: 'ATACANTE', email: 'a@test.invalid', user_metadata: {} };
    const { acceptOrgInvite } = await import('./accept-org-invite');
    const r = await acceptOrgInvite(INVITE_ID);
    expect(r.success).toBe(false);
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites()).toHaveLength(0);
  });

  it('sem sessão, convite expirado, convite já ativo e id inválido são recusados', async () => {
    const { acceptOrgInvite } = await import('./accept-org-invite');

    state.sessionUser = null;
    expect((await acceptOrgInvite(INVITE_ID)).success).toBe(false);

    state.sessionUser = { id: 'VICTIM', email: 'v@test.invalid', user_metadata: {} };
    state.invite = { ...state.invite, invited_expires_at: new Date(Date.now() - 1000).toISOString() };
    expect((await acceptOrgInvite(INVITE_ID)).success).toBe(false);

    state.invite = { ...state.invite, invited_expires_at: null, status: 'active' };
    expect((await acceptOrgInvite(INVITE_ID)).success).toBe(false);

    expect((await acceptOrgInvite('nao-e-uuid')).success).toBe(false);
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites()).toHaveLength(0);
  });
});

describe('acceptPendingInvite (callback do link do e-mail)', () => {
  it('conta existente com convite de terceiro, sem invited_to_org no metadata: nada muda', async () => {
    const { acceptPendingInvite } = await import('./accept-invite');
    const r = await acceptPendingInvite();
    expect(r).toEqual({ success: true, data: null });
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites()).toHaveLength(0);
  });

  it('conta nova convidada (metadata invited_to_org) com org auto vazia: aceita e troca de org', async () => {
    state.sessionUser = { id: 'VICTIM', email: 'v@test.invalid', user_metadata: { invited_to_org: 'ORG-M' } };
    const { acceptPendingInvite } = await import('./accept-invite');
    const r = await acceptPendingInvite();
    expect(r).toEqual({ success: true, data: { orgId: 'ORG-M' } });
    expect(orgDeletes()).toHaveLength(1);
  });

  it('com invited_to_org mas org atual com dados: não apaga e não aceita', async () => {
    state.sessionUser = { id: 'VICTIM', email: 'v@test.invalid', user_metadata: { invited_to_org: 'ORG-M' } };
    state.leads = 9;
    const { acceptPendingInvite } = await import('./accept-invite');
    const r = await acceptPendingInvite();
    expect(r).toEqual({ success: true, data: null });
    expect(orgDeletes()).toHaveLength(0);
    expect(memberWrites()).toHaveLength(0);
  });
});

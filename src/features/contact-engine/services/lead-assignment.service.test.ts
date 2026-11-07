import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  assignLeadByPolicy,
  decideLeadAssignment,
  orderRing,
  pickAssignee,
  runLeadAssignmentShadow,
  runLeadAssignmentShadowBatch,
  type AssignmentContext,
  type AssignmentMember,
} from './lead-assignment.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
// O recovery importa acoes de servidor e notificacoes; so as funcoes puras interessam.
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/notifications/services/notification.service', () => ({ createNotification: vi.fn() }));

type Row = Record<string, unknown>;

interface World {
  flags: Record<string, boolean>;
  policies: Row[];
  members: Row[];
  orgMembers: Row[];
  leads: Row[];
  enrollments: Row[];
  ownership: Row[];
  tablesRead: string[];
  rpcCalls: string[];
  tablesWritten: string[];
}

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeWorld(over: Partial<World> = {}): World {
  return {
    flags: { lead_assignment_shadow: true, lead_assignment_enforced: true, conversation_ownership_v1: true },
    policies: [{ id: 'pol-1', org_id: ORG, enabled: true, default_capacity: null, cursor_user_id: null, cursor_version: 0 }],
    members: [
      { org_id: ORG, user_id: 'u-a', eligible: true, capacity: null, position: 0 },
      { org_id: ORG, user_id: 'u-b', eligible: true, capacity: null, position: 1 },
      { org_id: ORG, user_id: 'u-c', eligible: true, capacity: null, position: 2 },
    ],
    orgMembers: [
      { org_id: ORG, user_id: 'u-a', status: 'active' },
      { org_id: ORG, user_id: 'u-b', status: 'active' },
      { org_id: ORG, user_id: 'u-c', status: 'active' },
    ],
    leads: [
      { id: 'l-1', org_id: ORG, assigned_to: null },
      { id: 'l-2', org_id: ORG, assigned_to: null },
      { id: 'l-x', org_id: OTHER_ORG, assigned_to: null },
    ],
    enrollments: [],
    ownership: [],
    tablesRead: [],
    rpcCalls: [],
    tablesWritten: [],
    ...over,
  };
}

/**
 * Banco em memoria. A RPC reproduz assign_lead_by_policy (trava por politica,
 * CAS no cursor, lead sem dono). JS e single-thread, o que equivale a
 * serializacao da trava FOR UPDATE; a atomicidade real e do Postgres.
 */
function installClient(w: World) {
  const tables: Record<string, Row[]> = {
    lead_assignment_policies: w.policies,
    lead_assignment_members: w.members,
    organization_members: w.orgMembers,
    leads: w.leads,
    conversation_ownership: w.ownership,
  };

  const from = (table: string) => {
    w.tablesRead.push(table);
    const filters: Array<(r: Row) => boolean> = [];
    let write = false;
    const b: Record<string, unknown> = {};
    const run = () => {
      if (write) return { data: null, error: { message: 'escrita direta nao permitida' } };
      if (table === 'app_flags') {
        return { data: [{ enabled: w.flags[currentKey] ?? false }], error: null };
      }
      if (table === 'cadence_enrollments') {
        let rows = w.enrollments.filter((r) => filters.every((f) => f(r)));
        rows = rows.map((r) => ({
          ...r,
          lead: { assigned_to: (w.leads.find((l) => l.id === r.lead_id) ?? {}).assigned_to ?? null },
        }));
        return { data: rows, error: null };
      }
      return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
    };
    let currentKey = '';
    b.select = vi.fn(() => b);
    b.limit = vi.fn(() => b);
    b.eq = vi.fn((k: string, v: unknown) => {
      if (table === 'app_flags' && k === 'key') currentKey = String(v);
      else filters.push((r) => r[k] === v);
      return b;
    });
    b.in = vi.fn((k: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[k]));
      return b;
    });
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      b[m] = vi.fn(() => {
        write = true;
        w.tablesWritten.push(table);
        return b;
      });
    }
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
    return b;
  };

  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    w.rpcCalls.push(fn);
    if (fn !== 'assign_lead_by_policy') return { data: null, error: { message: 'rpc desconhecida' } };
    const out = (outcome: string) => ({ data: [{ outcome }], error: null });
    const pol = w.policies.find((p) => p.org_id === a.p_org_id && p.enabled === true);
    if (!pol) return out('no_policy');
    if (pol.cursor_version !== a.p_expected_cursor_version) return out('cursor_conflict');
    const lead = w.leads.find((l) => l.id === a.p_lead_id && l.org_id === a.p_org_id);
    if (!lead) return out('lead_not_in_org');
    if (lead.assigned_to) return out('already_assigned');
    if (w.enrollments.some((e) => e.org_id === a.p_org_id && e.lead_id === a.p_lead_id && e.pending_assigned_to))
      return out('pending_assignment');
    if (w.ownership.some((o) => o.org_id === a.p_org_id && o.lead_id === a.p_lead_id && o.status === 'active' && o.owner_user_id))
      return out('conversation_owner');
    const eligible = w.members.some((m) => m.org_id === a.p_org_id && m.user_id === a.p_user_id && m.eligible === true)
      && w.orgMembers.some((m) => m.org_id === a.p_org_id && m.user_id === a.p_user_id && m.status === 'active');
    if (!eligible) return out('not_eligible');
    lead.assigned_to = a.p_user_id;
    pol.cursor_user_id = a.p_user_id;
    pol.cursor_version = (pol.cursor_version as number) + 1;
    return out('assigned');
  });

  vi.mocked(createServiceRoleClient).mockReturnValue({ from: vi.fn(from), rpc } as never);
  return { rpc };
}

const enroll = (leadId: string, over: Row = {}): Row => ({
  org_id: ORG,
  lead_id: leadId,
  status: 'active',
  pending_assigned_to: null,
  ...over,
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(createServiceRoleClient).mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

const member = (userId: string, position: number, over: Partial<AssignmentMember> = {}): AssignmentMember => ({
  userId,
  eligible: true,
  capacity: null,
  position,
  ...over,
});

const ctxOf = (over: Partial<AssignmentContext> = {}): AssignmentContext => ({
  policy: { id: 'p', defaultCapacity: null, cursorUserId: null, cursorVersion: 0 },
  members: [member('u-a', 0), member('u-b', 1), member('u-c', 2)],
  activeUserIds: new Set(['u-a', 'u-b', 'u-c']),
  loads: { 'u-a': 0, 'u-b': 0, 'u-c': 0 },
  ...over,
});

// ---------------------------------------------------------------------------
// Decisao pura
// ---------------------------------------------------------------------------

describe('desempate estavel e persistente', () => {
  it('menor carga vence, independente da ordem de leitura dos membros', () => {
    const loads = { 'u-a': 3, 'u-b': 1, 'u-c': 2 };
    const a = pickAssignee(ctxOf({ loads }));
    const b = pickAssignee(ctxOf({ loads, members: [member('u-c', 2), member('u-b', 1), member('u-a', 0)] }));
    expect(a.userId).toBe('u-b');
    expect(b.userId).toBe('u-b');
  });

  it('empate segue o anel (position, user_id), sem depender da ordem de leitura', () => {
    const shuffled = [member('u-c', 2), member('u-a', 0), member('u-b', 1)];
    expect(pickAssignee(ctxOf({ members: shuffled })).userId).toBe('u-a');
  });

  it('empate parte do usuario seguinte ao cursor e volta ao inicio no fim do anel', () => {
    const at = (cursor: string | null) =>
      pickAssignee(ctxOf({ policy: { id: 'p', defaultCapacity: null, cursorUserId: cursor, cursorVersion: 1 } })).userId;
    expect(at('u-a')).toBe('u-b');
    expect(at('u-b')).toBe('u-c');
    expect(at('u-c')).toBe('u-a');
    expect(at('fora-do-anel')).toBe('u-a');
  });

  it('mesma entrada, mesma saida (determinismo)', () => {
    const r = Array.from({ length: 5 }, () => pickAssignee(ctxOf()).userId);
    expect(new Set(r).size).toBe(1);
  });

  it('orderRing usa user_id para posicoes iguais', () => {
    expect(orderRing([member('u-z', 0), member('u-m', 0)], null)).toEqual(['u-m', 'u-z']);
  });
});

describe('capacidade e elegibilidade', () => {
  it('quem atingiu a capacidade sai da disputa, mesmo com menor carga relativa', () => {
    const ctx = ctxOf({
      members: [member('u-a', 0, { capacity: 2 }), member('u-b', 1), member('u-c', 2)],
      loads: { 'u-a': 2, 'u-b': 5, 'u-c': 6 },
    });
    expect(pickAssignee(ctx).userId).toBe('u-b');
  });

  it('capacidade propria sobrescreve a padrao da politica', () => {
    const ctx = ctxOf({
      policy: { id: 'p', defaultCapacity: 1, cursorUserId: null, cursorVersion: 0 },
      members: [member('u-a', 0, { capacity: 10 }), member('u-b', 1)],
      loads: { 'u-a': 5, 'u-b': 1 },
    });
    expect(pickAssignee(ctx).userId).toBe('u-a');
  });

  it('capacidade esgotada para todos: ninguem recebe', () => {
    const ctx = ctxOf({
      policy: { id: 'p', defaultCapacity: 2, cursorUserId: null, cursorVersion: 0 },
      loads: { 'u-a': 2, 'u-b': 3, 'u-c': 2 },
    });
    expect(pickAssignee(ctx)).toEqual({ userId: null, reason: 'capacity_exhausted' });
    expect(decideLeadAssignment({ assignedTo: null, pendingAssignedTo: [], conversationOwners: [] }, ctx)).toEqual({
      action: 'none',
      userId: null,
      reason: 'capacity_exhausted',
    });
  });

  it('capacidade 0 impede novos leads para o usuario', () => {
    const ctx = ctxOf({ members: [member('u-a', 0, { capacity: 0 }), member('u-b', 1)], loads: { 'u-a': 0, 'u-b': 9 } });
    expect(pickAssignee(ctx).userId).toBe('u-b');
  });

  it('usuario inativo na org ou inelegivel na politica nunca e escolhido', () => {
    const inactive = ctxOf({ activeUserIds: new Set(['u-b', 'u-c']), loads: { 'u-a': 0, 'u-b': 4, 'u-c': 5 } });
    expect(pickAssignee(inactive).userId).toBe('u-b');
    const ineligible = ctxOf({
      members: [member('u-a', 0, { eligible: false }), member('u-b', 1), member('u-c', 2)],
      loads: { 'u-a': 0, 'u-b': 4, 'u-c': 5 },
    });
    expect(pickAssignee(ineligible).userId).toBe('u-b');
    const none = ctxOf({ activeUserIds: new Set() });
    expect(pickAssignee(none)).toEqual({ userId: null, reason: 'no_eligible_member' });
  });

  it('retomada: usuario que volta a ficar ativo e elegivel volta a disputar', () => {
    const loads = { 'u-a': 0, 'u-b': 4, 'u-c': 5 };
    expect(pickAssignee(ctxOf({ activeUserIds: new Set(['u-b', 'u-c']), loads })).userId).toBe('u-b');
    expect(pickAssignee(ctxOf({ loads })).userId).toBe('u-a');
  });
});

describe('preservacao de dono', () => {
  const free = { assignedTo: null, pendingAssignedTo: [], conversationOwners: [] };

  it('assigned_to existente e respeitado', () => {
    expect(decideLeadAssignment({ ...free, assignedTo: 'u-c' }, ctxOf())).toEqual({
      action: 'keep_owner',
      userId: 'u-c',
      reason: 'assigned_to_preserved',
    });
  });

  it('pending_assigned_to e respeitado (menor id se houver varios, estavel)', () => {
    expect(decideLeadAssignment({ ...free, pendingAssignedTo: ['u-c', 'u-b'] }, ctxOf())).toMatchObject({
      action: 'keep_pending',
      userId: 'u-b',
    });
  });

  it('conversa em andamento mantem o dono da conversa', () => {
    expect(decideLeadAssignment({ ...free, conversationOwners: ['u-b'] }, ctxOf())).toMatchObject({
      action: 'keep_conversation_owner',
      userId: 'u-b',
    });
  });

  it('prioridade: assigned_to > pendente > conversa > politica', () => {
    const all = { assignedTo: 'u-a', pendingAssignedTo: ['u-b'], conversationOwners: ['u-c'] };
    expect(decideLeadAssignment(all, ctxOf()).action).toBe('keep_owner');
    expect(decideLeadAssignment({ ...all, assignedTo: null }, ctxOf()).action).toBe('keep_pending');
    expect(decideLeadAssignment({ ...all, assignedTo: null, pendingAssignedTo: [] }, ctxOf()).action).toBe(
      'keep_conversation_owner',
    );
  });

  it('dono inativo nao e desfeito: continua como dono', () => {
    const ctx = ctxOf({ activeUserIds: new Set(['u-b', 'u-c']) });
    expect(decideLeadAssignment({ ...free, assignedTo: 'u-a' }, ctx)).toMatchObject({ action: 'keep_owner', userId: 'u-a' });
  });

  it('sem politica: nada a fazer', () => {
    expect(decideLeadAssignment(free, ctxOf({ policy: null }))).toEqual({ action: 'none', userId: null, reason: 'no_policy' });
  });
});

// ---------------------------------------------------------------------------
// Flags desligadas
// ---------------------------------------------------------------------------

describe('flags desligadas nao tem efeito', () => {
  it('shadow desligada: nao le dados nem registra', async () => {
    const w = makeWorld({ flags: { lead_assignment_shadow: false, lead_assignment_enforced: false } });
    installClient(w);
    const run = await runLeadAssignmentShadowBatch({
      orgId: ORG,
      source: 'bulk_assign',
      leads: [{ leadId: 'l-1', currentAssignedTo: 'u-a' }],
    });
    expect(run).toEqual({ ran: false, entries: [] });
    expect(new Set(w.tablesRead)).toEqual(new Set(['app_flags']));
    expect(w.tablesWritten).toEqual([]);
    expect(w.rpcCalls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('flag ausente ou erro de leitura valem desligadas', async () => {
    const w = makeWorld({ flags: {} });
    installClient(w);
    expect((await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: null, source: 'inbound' }))).toBeNull();
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('indisponivel');
    });
    expect(await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: null, source: 'inbound' })).toBeNull();
    expect(await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' })).toMatchObject({ success: false, code: 'flag_disabled' });
  });

  it('enforced desligada: assignLeadByPolicy nao le dados nem chama RPC, mesmo com shadow ligada', async () => {
    const w = makeWorld({ flags: { lead_assignment_shadow: true, lead_assignment_enforced: false } });
    const { rpc } = installClient(w);
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toMatchObject({ success: false, code: 'flag_disabled' });
    expect(rpc).not.toHaveBeenCalled();
    expect(new Set(w.tablesRead)).toEqual(new Set(['app_flags']));
    expect(w.leads.find((l) => l.id === 'l-1')?.assigned_to).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

describe('shadow: compara e registra sem alterar nada', () => {
  it('registra log estruturado sem PII e nao grava em lugar algum', async () => {
    const w = makeWorld({ leads: [{ id: 'l-1', org_id: ORG, assigned_to: 'u-c' }] });
    const before = JSON.stringify(w.leads) + JSON.stringify(w.policies) + JSON.stringify(w.enrollments);
    installClient(w);

    const entry = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: 'u-c', source: 'inbound' });

    expect(entry).toMatchObject({ current: 'u-c', diverged: true, decision: { action: 'assign', userId: 'u-a' } });
    expect(warn).toHaveBeenCalledTimes(1);
    const log = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(log).toMatchObject({ event: 'lead_assignment_shadow', orgId: ORG, leadId: 'l-1', current: 'u-c', proposed: 'u-a', diverged: true });
    expect(Object.keys(log).sort()).toEqual(
      ['action', 'current', 'cursorVersion', 'diverged', 'event', 'leadId', 'orgId', 'proposed', 'reason', 'source'].sort(),
    );
    expect(w.tablesWritten).toEqual([]);
    expect(w.rpcCalls).toEqual([]);
    expect(JSON.stringify(w.leads) + JSON.stringify(w.policies) + JSON.stringify(w.enrollments)).toBe(before);
  });

  it('nao diverge quando a atribuicao atual coincide com a proposta', async () => {
    const w = makeWorld({ leads: [{ id: 'l-1', org_id: ORG, assigned_to: 'u-a' }] });
    installClient(w);
    const entry = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: 'u-a', source: 'inbound' });
    expect(entry?.diverged).toBe(false);
  });

  it('nunca avanca o cursor persistido (rodizio vigente intacto), nem em lote', async () => {
    const w = makeWorld();
    installClient(w);
    const run = await runLeadAssignmentShadowBatch({
      orgId: ORG,
      source: 'bulk_assign',
      leads: [
        { leadId: 'l-1', currentAssignedTo: null },
        { leadId: 'l-2', currentAssignedTo: null },
      ],
    });
    // simulacao local avanca o anel: a, b
    expect(run.entries.map((e) => e.decision?.userId)).toEqual(['u-a', 'u-b']);
    expect(w.policies[0]).toMatchObject({ cursor_user_id: null, cursor_version: 0 });
  });

  it('lote respeita o teto e ignora lead de outra organizacao', async () => {
    const w = makeWorld();
    installClient(w);
    const run = await runLeadAssignmentShadowBatch({
      orgId: ORG,
      source: 'bulk_assign',
      leads: [
        { leadId: 'l-x', currentAssignedTo: null },
        ...Array.from({ length: 150 }, (_, i) => ({ leadId: `nao-existe-${i}`, currentAssignedTo: null })),
      ],
    });
    expect(run.entries).toHaveLength(100);
    expect(run.entries[0]).toMatchObject({ leadId: 'l-x', decision: null, diverged: null });
  });

  it('preserva conversa em andamento e pendente no calculo', async () => {
    const w = makeWorld({
      ownership: [{ org_id: ORG, lead_id: 'l-1', status: 'active', owner_user_id: 'u-c' }],
      enrollments: [enroll('l-2', { pending_assigned_to: 'u-b', status: 'paused' })],
    });
    installClient(w);
    const run = await runLeadAssignmentShadowBatch({
      orgId: ORG,
      source: 'bulk_assign',
      leads: [
        { leadId: 'l-1', currentAssignedTo: null },
        { leadId: 'l-2', currentAssignedTo: null },
      ],
    });
    expect(run.entries[0]?.decision).toMatchObject({ action: 'keep_conversation_owner', userId: 'u-c' });
    expect(run.entries[1]?.decision).toMatchObject({ action: 'keep_pending', userId: 'u-b' });
  });

  it('ownership do PR05 desligado: nao consulta a tabela de ownership', async () => {
    const w = makeWorld({
      flags: { lead_assignment_shadow: true, conversation_ownership_v1: false },
      ownership: [{ org_id: ORG, lead_id: 'l-1', status: 'active', owner_user_id: 'u-c' }],
    });
    installClient(w);
    const entry = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: null, source: 'inbound' });
    expect(w.tablesRead).not.toContain('conversation_ownership');
    expect(entry?.decision?.action).toBe('assign');
  });

  it('isolamento por org: politica, membros e cargas de outra org nao entram', async () => {
    const w = makeWorld({
      policies: [
        { id: 'pol-1', org_id: ORG, enabled: true, default_capacity: null, cursor_user_id: null, cursor_version: 0 },
        { id: 'pol-2', org_id: OTHER_ORG, enabled: true, default_capacity: null, cursor_user_id: null, cursor_version: 0 },
      ],
      members: [
        { org_id: ORG, user_id: 'u-a', eligible: true, capacity: null, position: 0 },
        { org_id: OTHER_ORG, user_id: 'o-1', eligible: true, capacity: null, position: 0 },
      ],
      orgMembers: [
        { org_id: ORG, user_id: 'u-a', status: 'active' },
        { org_id: OTHER_ORG, user_id: 'o-1', status: 'active' },
      ],
      enrollments: [enroll('l-x', { org_id: OTHER_ORG, pending_assigned_to: 'o-1' })],
    });
    installClient(w);
    const entry = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: null, source: 'inbound' });
    expect(entry?.decision).toMatchObject({ action: 'assign', userId: 'u-a' });
    // pedir lead da outra org como se fosse desta nao revela nada
    const cross = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-x', currentAssignedTo: null, source: 'inbound' });
    expect(cross?.decision).toBeNull();
  });

  it('politica desligada ou ausente: sem proposta', async () => {
    const w = makeWorld({ policies: [{ id: 'p', org_id: ORG, enabled: false, default_capacity: null, cursor_user_id: null, cursor_version: 0 }] });
    installClient(w);
    const entry = await runLeadAssignmentShadow({ orgId: ORG, leadId: 'l-1', currentAssignedTo: null, source: 'inbound' });
    expect(entry?.decision).toEqual({ action: 'none', userId: null, reason: 'no_policy' });
  });
});

// ---------------------------------------------------------------------------
// Enforced: concorrencia e CAS
// ---------------------------------------------------------------------------

describe('enforced: atribuicao atomica', () => {
  it('atribui lead sem dono pela menor carga e avanca o cursor', async () => {
    const w = makeWorld({ enrollments: [enroll('l-9', { lead_id: 'l-9' })] });
    w.leads.push({ id: 'l-9', org_id: ORG, assigned_to: 'u-a' });
    installClient(w);
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toEqual({ success: true, data: { assigned: true, userId: 'u-b' } });
    expect(w.leads.find((l) => l.id === 'l-1')?.assigned_to).toBe('u-b');
    expect(w.policies[0]).toMatchObject({ cursor_user_id: 'u-b', cursor_version: 1 });
  });

  it('concorrencia no mesmo lead: um unico vencedor, sem duplicar nem sobrescrever', async () => {
    const w = makeWorld();
    installClient(w);
    const results = await Promise.all(Array.from({ length: 8 }, () => assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' })));
    const assigned = results.filter((r) => r.success && r.data.assigned);
    expect(assigned).toHaveLength(1);
    const others = results.filter((r) => !(r.success && r.data.assigned));
    for (const r of others) {
      expect(r).toMatchObject({ success: true, data: { assigned: false, reason: 'assigned_to_preserved' } });
    }
    expect(w.policies[0]?.cursor_version).toBe(1);
    const winner = assigned[0]?.success ? assigned[0].data : null;
    expect(w.leads.find((l) => l.id === 'l-1')?.assigned_to).toBe(winner && 'userId' in winner ? winner.userId : 'x');
  });

  it('concorrencia em leads diferentes: cursor serializa e distribui sem repetir o mesmo empate', async () => {
    const w = makeWorld();
    w.leads.push({ id: 'l-3', org_id: ORG, assigned_to: null });
    installClient(w);
    const results = await Promise.all(['l-1', 'l-2', 'l-3'].map((id) => assignLeadByPolicy({ orgId: ORG, leadId: id })));
    expect(results.every((r) => r.success && r.data.assigned)).toBe(true);
    const owners = ['l-1', 'l-2', 'l-3'].map((id) => w.leads.find((l) => l.id === id)?.assigned_to);
    expect(new Set(owners).size).toBe(3);
    expect(w.policies[0]?.cursor_version).toBe(3);
  });

  it('perde o CAS do cursor: reavalia com o estado novo e conclui', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    const real = rpc.getMockImplementation()!;
    let bumped = false;
    rpc.mockImplementation(async (fn: string, a: Record<string, unknown>) => {
      if (!bumped) {
        bumped = true;
        w.policies[0]!.cursor_version = 1;
        w.policies[0]!.cursor_user_id = 'u-a';
      }
      return real(fn, a);
    });
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toEqual({ success: true, data: { assigned: true, userId: 'u-b' } });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('conflito de cursor persistente: falha explicita depois de 3 tentativas', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    rpc.mockImplementation(async () => ({ data: [{ outcome: 'cursor_conflict' }], error: null }));
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toMatchObject({ success: false, code: 'cursor_conflict' });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(w.leads.find((l) => l.id === 'l-1')?.assigned_to).toBeNull();
  });

  it('nao sobrescreve dono, pendente nem conversa; nao chama a RPC', async () => {
    const w = makeWorld({
      leads: [
        { id: 'l-1', org_id: ORG, assigned_to: 'u-c' },
        { id: 'l-2', org_id: ORG, assigned_to: null },
        { id: 'l-3', org_id: ORG, assigned_to: null },
      ],
      enrollments: [enroll('l-2', { pending_assigned_to: 'u-b' })],
      ownership: [{ org_id: ORG, lead_id: 'l-3', status: 'active', owner_user_id: 'u-a' }],
    });
    const { rpc } = installClient(w);
    const r1 = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    const r2 = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-2' });
    const r3 = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-3' });
    expect(r1).toMatchObject({ data: { assigned: false, reason: 'assigned_to_preserved' } });
    expect(r2).toMatchObject({ data: { assigned: false, reason: 'pending_assignment_preserved' } });
    expect(r3).toMatchObject({ data: { assigned: false, reason: 'conversation_owner_preserved' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(w.leads.map((l) => l.assigned_to)).toEqual(['u-c', null, null]);
  });

  it('a RPC tambem protege contra pendente/conversa surgidos depois da leitura', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    const real = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (fn: string, a: Record<string, unknown>) => {
      w.ownership.push({ org_id: ORG, lead_id: 'l-1', status: 'active', owner_user_id: 'u-c' });
      return real(fn, a);
    });
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toMatchObject({ success: true, data: { assigned: false, reason: 'conversation_owner_preserved' } });
    expect(w.leads.find((l) => l.id === 'l-1')?.assigned_to).toBeNull();
  });

  it('capacidade esgotada e usuario inativo: nao atribui', async () => {
    const w = makeWorld({
      policies: [{ id: 'pol-1', org_id: ORG, enabled: true, default_capacity: 1, cursor_user_id: null, cursor_version: 0 }],
      orgMembers: [
        { org_id: ORG, user_id: 'u-a', status: 'active' },
        { org_id: ORG, user_id: 'u-b', status: 'suspended' },
        { org_id: ORG, user_id: 'u-c', status: 'removed' },
      ],
      leads: [
        { id: 'l-1', org_id: ORG, assigned_to: null },
        { id: 'l-9', org_id: ORG, assigned_to: 'u-a' },
      ],
      enrollments: [enroll('l-9')],
    });
    const { rpc } = installClient(w);
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toMatchObject({ success: true, data: { assigned: false, reason: 'capacity_exhausted' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('isolamento por org: lead de outra organizacao nao e atribuido', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-x' });
    expect(res).toMatchObject({ success: true, data: { assigned: false, reason: 'lead_not_in_org' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(w.leads.find((l) => l.id === 'l-x')?.assigned_to).toBeNull();
  });

  it('retomada: usuario reativado volta a receber leads', async () => {
    const w = makeWorld({
      orgMembers: [
        { org_id: ORG, user_id: 'u-a', status: 'suspended' },
        { org_id: ORG, user_id: 'u-b', status: 'active' },
        { org_id: ORG, user_id: 'u-c', status: 'active' },
      ],
    });
    installClient(w);
    const first = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(first).toMatchObject({ data: { assigned: true, userId: 'u-b' } });
    w.orgMembers[0]!.status = 'active';
    w.policies[0]!.cursor_user_id = null;
    const second = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-2' });
    expect(second).toMatchObject({ data: { assigned: true, userId: 'u-a' } });
  });

  it('falha de leitura: falha fechada, sem escrita', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    w.policies = null as never;
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn((t: string) => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'limit']) b[m] = vi.fn(() => b);
        b.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve(t === 'app_flags' ? { data: [{ enabled: true }], error: null } : { data: null, error: { message: 'x' } }).then(ok);
        return b;
      }),
      rpc,
    } as never);
    const res = await assignLeadByPolicy({ orgId: ORG, leadId: 'l-1' });
    expect(res).toMatchObject({ success: false, code: 'read_failed' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Numeros de envio
// ---------------------------------------------------------------------------

describe('nenhum numero e rotacionado', () => {
  it('shadow e enforced so tocam tabelas de distribuicao, e escrevem apenas via assign_lead_by_policy', async () => {
    const w = makeWorld();
    installClient(w);
    await runLeadAssignmentShadowBatch({ orgId: ORG, source: 'bulk_assign', leads: [{ leadId: 'l-1', currentAssignedTo: null }] });
    await assignLeadByPolicy({ orgId: ORG, leadId: 'l-2' });

    const allowed = new Set([
      'app_flags',
      'lead_assignment_policies',
      'lead_assignment_members',
      'organization_members',
      'cadence_enrollments',
      'leads',
      'conversation_ownership',
    ]);
    for (const t of w.tablesRead) expect(allowed.has(t)).toBe(true);
    expect(w.tablesRead.some((t) => /instance|sender|whatsapp|number|provider|outbox/i.test(t))).toBe(false);
    expect(w.tablesWritten).toEqual([]);
    expect(new Set(w.rpcCalls)).toEqual(new Set(['assign_lead_by_policy']));
  });

  it('o codigo do servico nao referencia numeros, instancias nem provedores de envio', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const file = join(process.cwd(), 'src/features/contact-engine/services/lead-assignment.service.ts');
    const src = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(src).not.toMatch(/sender_instance|whatsapp|evolution|meta_cloud|send_outbox|rotat|phone|telefone/i);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveUserProfiles } from '@/lib/auth/user-directory';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { loadLeadCardExtras } from './cockpit-auto-dial-extras.service';

vi.mock('@/lib/auth/user-directory', () => ({ resolveUserProfiles: vi.fn() }));

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ME = 'user-1';
const PREV = 'user-9';
const LEAD = 'lead-1';

let db: AutoDialDb;
function setup(tables: Record<string, Row[]>) {
  db = { tables: { leads: [], loss_reasons: [], cadence_enrollments: [], calls: [], ...tables }, failReads: new Set(), reads: [], writes: [], rpc: vi.fn() };
  return makeAutoDialClient(db) as never;
}
const lead = (over: Row = {}): Row => ({
  id: LEAD, org_id: ORG, lead_source: 'Blackbox', canal: 'whatsapp', created_at: '2026-01-10T12:00:00Z', lost_at: '2026-10-01T12:00:00Z',
  loss_reason_id: 'r1', loss_notes: 'Disse que não tem budget', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveUserProfiles).mockResolvedValue(new Map([[PREV, { displayName: 'Maria Souza' }]]) as never);
});

describe('loadLeadCardExtras (FR-24, A-D7)', () => {
  it('devolve origem, canal, datas, motivo e notas da perda e o último SDR que ligou', async () => {
    const client = setup({
      leads: [lead()],
      loss_reasons: [{ id: 'r1', org_id: ORG, name: 'Sem budget' }],
      calls: [{ id: 'c1', org_id: ORG, lead_id: LEAD, user_id: PREV, created_at: '2026-09-20T12:00:00Z' }],
    });
    expect(await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME })).toEqual({
      leadSource: 'Blackbox',
      canal: 'whatsapp',
      createdAt: '2026-01-10T12:00:00Z',
      lostAt: '2026-10-01T12:00:00Z',
      lossReasonName: 'Sem budget',
      lossNotes: 'Disse que não tem budget',
      previousSdr: { userId: PREV, name: 'Maria Souza' },
    });
  });

  it('SDR antigo é OUTRO usuário: as ligações do próprio usuário atual não contam', async () => {
    const client = setup({ leads: [lead()], calls: [{ id: 'c1', org_id: ORG, lead_id: LEAD, user_id: ME, created_at: '2026-09-20T12:00:00Z' }] });
    expect((await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME }))?.previousSdr).toBeNull();
    expect(resolveUserProfiles).not.toHaveBeenCalled();
  });

  it('sem nota no lead: usa a da inscrição de cadência (só se o lead foi perdido)', async () => {
    const client = setup({
      leads: [lead({ loss_notes: null })],
      cadence_enrollments: [{ id: 'e1', org_id: ORG, lead_id: LEAD, loss_notes: 'nota da cadência', completed_at: '2026-10-01T12:00:00Z' }],
    });
    expect((await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME }))?.lossNotes).toBe('nota da cadência');
    const open = setup({
      leads: [lead({ loss_notes: null, lost_at: null, loss_reason_id: null })],
      cadence_enrollments: [{ id: 'e1', org_id: ORG, lead_id: LEAD, loss_notes: 'nota da cadência', completed_at: '2026-10-01T12:00:00Z' }],
    });
    const r = await loadLeadCardExtras({ client: open, orgId: ORG, leadId: LEAD, currentUserId: ME });
    expect(r).toMatchObject({ lostAt: null, lossReasonName: null, lossNotes: null });
  });

  it('lead lido de outra organização NÃO aparece (org_id em toda consulta)', async () => {
    const client = setup({
      leads: [lead({ org_id: OTHER_ORG })],
      loss_reasons: [{ id: 'r1', org_id: OTHER_ORG, name: 'Segredo da outra org' }],
      calls: [{ id: 'c1', org_id: OTHER_ORG, lead_id: LEAD, user_id: PREV, created_at: '2026-09-20T12:00:00Z' }],
    });
    expect(await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME })).toBeNull();
    for (const r of db.reads) expect(r.eq.org_id, r.table).toBe(ORG);
  });

  it('motivo de perda de outra organização não vaza para o lead desta', async () => {
    const client = setup({ leads: [lead()], loss_reasons: [{ id: 'r1', org_id: OTHER_ORG, name: 'Segredo da outra org' }] });
    expect((await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME }))?.lossReasonName).toBeNull();
  });

  it('ligação de outra organização não vira "SDR antigo"', async () => {
    const client = setup({ leads: [lead()], calls: [{ id: 'c1', org_id: OTHER_ORG, lead_id: LEAD, user_id: PREV, created_at: '2026-09-20T12:00:00Z' }] });
    expect((await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME }))?.previousSdr).toBeNull();
  });

  it('falha de leitura do lead = null (não bloqueia a ligação); falha em tabela auxiliar não derruba o resto', async () => {
    const client = setup({ leads: [lead()] });
    db.failReads.add('leads');
    expect(await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME })).toBeNull();
    const c2 = setup({ leads: [lead()] });
    db.failReads.add('loss_reasons');
    expect(await loadLeadCardExtras({ client: c2, orgId: ORG, leadId: LEAD, currentUserId: ME })).toMatchObject({ leadSource: 'Blackbox', lossReasonName: null });
  });

  it('nome do usuário não encontrado: cai para o início do id', async () => {
    vi.mocked(resolveUserProfiles).mockResolvedValue(new Map() as never);
    const client = setup({ leads: [lead()], calls: [{ id: 'c1', org_id: ORG, lead_id: LEAD, user_id: 'abcdef12-0000', created_at: '2026-09-20T12:00:00Z' }] });
    expect((await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME }))?.previousSdr).toEqual({ userId: 'abcdef12-0000', name: 'abcdef12' });
  });

  it('só lê (nunca escreve)', async () => {
    const client = setup({ leads: [lead()] });
    await loadLeadCardExtras({ client, orgId: ORG, leadId: LEAD, currentUserId: ME });
    expect(db.writes).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('./crm-push.service', () => ({
  pushConfirmedMeetingToCrm: vi.fn(),
}));

import { pushConfirmedMeetingToCrm } from './crm-push.service';

import { CRM_IN_CHUNK, reconcileConfirmedMeetingsToCrm, selectCrmEligibleWonLeads } from './crm-reconcile.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const LEAD_CONFIRMED = 'lead-confirmed'; // closer + "Realizada"
const LEAD_NO_CLOSER = 'lead-no-closer'; // sem closer
const LEAD_PENDING = 'lead-pending'; // closer sem "Realizada"
const LEAD_SYNCED = 'lead-synced'; // já tem card

interface LeadRow {
  id: string;
  closer_id: string | null;
}

const WON_LEADS: LeadRow[] = [
  { id: LEAD_CONFIRMED, closer_id: 'closer-1' },
  { id: LEAD_NO_CLOSER, closer_id: null },
  { id: LEAD_PENDING, closer_id: 'closer-2' },
  { id: LEAD_SYNCED, closer_id: 'closer-1' },
];

/** Builder encadeável que resolve com `rows` e registra os filtros chamados. */
function chain(rows: unknown[], calls?: Record<string, (...args: unknown[]) => void>) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'gte', 'order', 'limit']) {
    c[m] = vi.fn((...args: unknown[]) => {
      calls?.[m]?.(...args);
      return c;
    });
  }
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(resolve);
  return c;
}

const leadsCalls = { eq: vi.fn(), gte: vi.fn(), limit: vi.fn() };
const interactionsCalls = { in: vi.fn() };

function wireTables(opts: { leadsByOrg?: Record<string, LeadRow[]>; confirmed?: string[]; synced?: string[]; orgs?: string[] } = {}) {
  const leadsByOrg = opts.leadsByOrg ?? { [ORG_A]: WON_LEADS };
  const confirmed = opts.confirmed ?? [LEAD_CONFIRMED];
  const synced = opts.synced ?? [LEAD_SYNCED];
  const orgs = opts.orgs ?? Object.keys(leadsByOrg);
  mockFrom.mockImplementation((table: string) => {
    if (table === 'crm_connections') return chain(orgs.map((org_id) => ({ org_id })));
    if (table === 'leads') {
      // devolve as linhas da org pedida no `.eq('org_id', …)`
      let org: string | null = null;
      const c = chain([], leadsCalls);
      c.eq = vi.fn((col: string, val: string) => {
        leadsCalls.eq(col, val);
        if (col === 'org_id') org = val;
        return c;
      });
      c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: leadsByOrg[org ?? ''] ?? [] }).then(resolve);
      return c;
    }
    if (table === 'closer_feedback_requests') {
      let ids: string[] = [];
      const c = chain([]);
      c.in = vi.fn((_col: string, val: string[]) => {
        ids = val;
        return c;
      });
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: confirmed.filter((id) => ids.includes(id)).map((lead_id) => ({ lead_id })) }).then(resolve);
      return c;
    }
    if (table === 'interactions') {
      let ids: string[] = [];
      const c = chain([], interactionsCalls);
      c.in = vi.fn((_col: string, val: string[]) => {
        interactionsCalls.in(_col, val);
        ids = val;
        return c;
      });
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: synced.filter((id) => ids.includes(id)).map((lead_id) => ({ lead_id })) }).then(resolve);
      return c;
    }
    throw new Error(`tabela inesperada: ${table}`);
  });
}

describe('selectCrmEligibleWonLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireTables();
  });

  it('pula lead já sincronizado e lead com closer sem "Realizada"; entra sem closer ou confirmado', async () => {
    const { candidates, skipped } = await selectCrmEligibleWonLeads(mockSupabase as never, WON_LEADS);

    expect(candidates.map((l) => l.id)).toEqual([LEAD_CONFIRMED, LEAD_NO_CLOSER]);
    expect(skipped).toEqual([
      { id: LEAD_PENDING, reason: 'meeting_not_confirmed' },
      { id: LEAD_SYNCED, reason: 'already_synced' },
    ]);
  });

  it('consulta em lotes de 100 ids (limite de URL do PostgREST)', async () => {
    const many: LeadRow[] = Array.from({ length: 250 }, (_, i) => ({ id: `lead-${i}`, closer_id: null }));
    wireTables({ leadsByOrg: { [ORG_A]: many }, synced: [] });

    const { candidates } = await selectCrmEligibleWonLeads(mockSupabase as never, many);

    expect(candidates).toHaveLength(250);
    expect(interactionsCalls.in).toHaveBeenCalledTimes(3);
    for (const call of interactionsCalls.in.mock.calls) {
      expect((call[1] as string[]).length).toBeLessThanOrEqual(CRM_IN_CHUNK);
    }
  });

  it('lista vazia não consulta nada', async () => {
    const res = await selectCrmEligibleWonLeads(mockSupabase as never, []);
    expect(res).toEqual({ candidates: [], skipped: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('reconcileConfirmedMeetingsToCrm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pushConfirmedMeetingToCrm).mockResolvedValue({ dealCreated: true, dealExternalId: '26600000' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wireTables();
  });
  afterEach(() => vi.restoreAllMocks());

  it('empurra só os elegíveis dos últimos 14 dias e conta os recuperados', async () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const res = await reconcileConfirmedMeetingsToCrm({ now });

    expect(leadsCalls.gte).toHaveBeenCalledWith('won_at', '2026-10-15T12:00:00.000Z');
    expect(leadsCalls.eq).toHaveBeenCalledWith('status', 'won');
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledTimes(2);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG_A, LEAD_CONFIRMED);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG_A, LEAD_NO_CLOSER);
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalledWith(ORG_A, LEAD_PENDING);
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalledWith(ORG_A, LEAD_SYNCED);

    expect(res).toMatchObject({ orgs: 1, candidates: 2, recovered: 2, notCreated: 0, failed: 0, abortedByNetwork: false });
    expect(res.recoveredLeadIds).toEqual([LEAD_CONFIRMED, LEAD_NO_CLOSER]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('recuperado'), 2, 2, 1, `${LEAD_CONFIRMED},${LEAD_NO_CLOSER}`);
  });

  it('varre cada org com CRM conectado, cada uma com seus leads', async () => {
    wireTables({
      leadsByOrg: { [ORG_A]: [{ id: 'a-1', closer_id: null }], [ORG_B]: [{ id: 'b-1', closer_id: null }] },
      synced: [],
    });

    const res = await reconcileConfirmedMeetingsToCrm();

    expect(res.orgs).toBe(2);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG_A, 'a-1');
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG_B, 'b-1');
  });

  it('push sem card conta como notCreated; erro de API conta como failed e segue', async () => {
    vi.mocked(pushConfirmedMeetingToCrm)
      .mockResolvedValueOnce({ dealCreated: false, skippedReason: 'no_defaults' })
      .mockRejectedValueOnce(new Error('Kommo API error (400): bad'));

    const res = await reconcileConfirmedMeetingsToCrm();

    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ recovered: 0, notCreated: 1, failed: 1, abortedByNetwork: false });
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('recuperado'), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('rede fora (retry esgotado): interrompe a varredura e sinaliza abortedByNetwork', async () => {
    wireTables({
      leadsByOrg: { [ORG_A]: [{ id: 'a-1', closer_id: null }, { id: 'a-2', closer_id: null }], [ORG_B]: [{ id: 'b-1', closer_id: null }] },
      synced: [],
    });
    vi.mocked(pushConfirmedMeetingToCrm).mockRejectedValueOnce(
      new Error('fetch failed', { cause: Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }) }),
    );

    const res = await reconcileConfirmedMeetingsToCrm();

    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ failed: 1, recovered: 0, abortedByNetwork: true });
  });

  it('sem org com CRM conectado não consulta leads', async () => {
    wireTables({ leadsByOrg: {}, orgs: [] });

    const res = await reconcileConfirmedMeetingsToCrm();

    expect(res).toMatchObject({ orgs: 0, candidates: 0, recovered: 0 });
    expect(leadsCalls.eq).not.toHaveBeenCalled();
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('@/lib/auth/verify-service-role', () => ({
  verifyServiceRole: vi.fn(() => true),
}));

vi.mock('@/features/leads/services/crm-push.service', () => ({
  pushConfirmedMeetingToCrm: vi.fn(),
}));

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { pushConfirmedMeetingToCrm } from '@/features/leads/services/crm-push.service';

import { POST } from './route';

const ORG = '11111111-1111-4111-8111-111111111111';
const LEAD_CONFIRMED = '22222222-2222-4222-8222-222222222222'; // closer + "Realizada"
const LEAD_NO_CLOSER = '33333333-3333-4333-8333-333333333333'; // sem closer
const LEAD_PENDING = '44444444-4444-4444-8444-444444444444'; // closer sem feedback
const LEAD_SYNCED = '55555555-5555-4555-8555-555555555555'; // já tem card
const LEAD_MISSING = '66666666-6666-4666-8666-666666666666'; // não é ganho / não existe

interface LeadRow {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  won_at: string | null;
  closer_id: string | null;
}

const WON_LEADS: LeadRow[] = [
  { id: LEAD_CONFIRMED, razao_social: 'Matte Doce', nome_fantasia: 'Matte Doce Pinheiros', cnpj: '1', won_at: '2026-10-27', closer_id: 'closer-1' },
  { id: LEAD_NO_CLOSER, razao_social: 'Sem Closer', nome_fantasia: null, cnpj: '2', won_at: '2026-10-27', closer_id: null },
  { id: LEAD_PENDING, razao_social: 'Esperando', nome_fantasia: null, cnpj: '3', won_at: '2026-10-28', closer_id: 'closer-2' },
  { id: LEAD_SYNCED, razao_social: 'Já Sincronizado', nome_fantasia: null, cnpj: '4', won_at: '2026-10-26', closer_id: 'closer-1' },
];

/** Registra as chamadas de filtro do builder de leads para o teste inspecionar. */
const leadsCalls = { in: vi.fn(), order: vi.fn(), limit: vi.fn() };

function leadsChain(rows: LeadRow[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.in = vi.fn((...args: unknown[]) => {
    leadsCalls.in(...args);
    return c;
  });
  c.order = vi.fn((...args: unknown[]) => {
    leadsCalls.order(...args);
    return c;
  });
  c.limit = vi.fn((...args: unknown[]) => {
    leadsCalls.limit(...args);
    return c;
  });
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(resolve);
  return c;
}

function feedbackChain(confirmedIds: string[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: confirmedIds.map((lead_id) => ({ lead_id })) }).then(resolve);
  return c;
}

function interactionsChain(syncedIds: string[]) {
  const c: Record<string, unknown> = {};
  let leadId: string | null = null;
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn((col: string, val: string) => {
    if (col === 'lead_id') leadId = val;
    return c;
  });
  c.limit = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: leadId && syncedIds.includes(leadId) ? { id: 'int-1' } : null, error: null }),
  );
  return c;
}

function wireTables(opts: { leads?: LeadRow[]; confirmed?: string[]; synced?: string[] } = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'leads') return leadsChain(opts.leads ?? WON_LEADS);
    if (table === 'closer_feedback_requests') return feedbackChain(opts.confirmed ?? [LEAD_CONFIRMED]);
    if (table === 'interactions') return interactionsChain(opts.synced ?? [LEAD_SYNCED]);
    throw new Error(`tabela inesperada: ${table}`);
  });
}

function req(body: unknown) {
  return new Request('https://example.com/api/workers/backfill-kommo-orphans', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify(body),
  });
}

describe('backfill-kommo-orphans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyServiceRole).mockReturnValue(true);
    vi.mocked(pushConfirmedMeetingToCrm).mockResolvedValue({ dealCreated: true, dealExternalId: '26600000' });
    wireTables();
  });

  it('rejeita sem service role', async () => {
    vi.mocked(verifyServiceRole).mockReturnValueOnce(false);
    const res = await POST(req({ orgId: ORG }));
    expect(res.status).toBe(401);
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalled();
  });

  it('exige orgId UUID e leadIds válidos', async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ orgId: 'org-1' }))).status).toBe(400);
    expect((await POST(req({ orgId: ORG, leadIds: [] }))).status).toBe(400);
    expect((await POST(req({ orgId: ORG, leadIds: ['nao-e-uuid'] }))).status).toBe(400);
    expect((await POST(req({ orgId: ORG, leadIds: 'abc' }))).status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('modo leadIds: filtra pelos ids, empurra só os elegíveis e relata o resto', async () => {
    const res = await POST(req({ orgId: ORG, leadIds: [LEAD_CONFIRMED, LEAD_NO_CLOSER, LEAD_PENDING, LEAD_SYNCED, LEAD_MISSING] }));
    expect(res.status).toBe(200);
    const json = await res.json();

    // consulta por lista explícita, sem varredura por limite
    expect(leadsCalls.in).toHaveBeenCalledWith('id', [LEAD_CONFIRMED, LEAD_NO_CLOSER, LEAD_PENDING, LEAD_SYNCED, LEAD_MISSING]);
    expect(leadsCalls.order).not.toHaveBeenCalled();
    expect(leadsCalls.limit).not.toHaveBeenCalled();

    // empurra com a função que respeita o crm_options do Ganho
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledTimes(2);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG, LEAD_CONFIRMED);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledWith(ORG, LEAD_NO_CLOSER);

    expect(json.found).toBe(2);
    expect(json.pushed).toBe(2);
    expect(json.failed).toBe(0);
    expect(json.skipped).toEqual(
      expect.arrayContaining([
        { id: LEAD_PENDING, reason: 'meeting_not_confirmed' },
        { id: LEAD_SYNCED, reason: 'already_synced' },
      ]),
    );
    expect(json.notFound).toEqual([LEAD_MISSING]);
  });

  it('dryRun lista os candidatos sem chamar o CRM', async () => {
    // o mock não aplica o `.in()`: devolve só o que o banco devolveria para esses ids
    wireTables({ leads: WON_LEADS.filter((l) => [LEAD_CONFIRMED, LEAD_PENDING].includes(l.id)) });
    const res = await POST(req({ orgId: ORG, leadIds: [LEAD_CONFIRMED, LEAD_PENDING], dryRun: true }));
    const json = await res.json();
    expect(json.dryRun).toBe(true);
    expect(json.leads.map((l: { id: string }) => l.id)).toEqual([LEAD_CONFIRMED]);
    expect(json.skipped).toEqual([{ id: LEAD_PENDING, reason: 'meeting_not_confirmed' }]);
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalled();
  });

  it('push sem deal (ex.: Kommo fora) conta como notCreated, exceção conta como failed', async () => {
    vi.mocked(pushConfirmedMeetingToCrm)
      .mockResolvedValueOnce({ dealCreated: false, skippedReason: 'no_contact_id' })
      .mockRejectedValueOnce(new Error('fetch failed'));
    const res = await POST(req({ orgId: ORG, leadIds: [LEAD_CONFIRMED, LEAD_NO_CLOSER] }));
    const json = await res.json();
    expect(json.pushed).toBe(0);
    expect(json.notCreated).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: LEAD_CONFIRMED, result: { dealCreated: false, skippedReason: 'no_contact_id' } }),
        expect.objectContaining({ id: LEAD_NO_CLOSER, result: { error: 'fetch failed' } }),
      ]),
    );
  });

  it('modo varredura: últimos ganhos por limite, mesma regra do closer', async () => {
    const res = await POST(req({ orgId: ORG, limit: 50 }));
    const json = await res.json();
    expect(leadsCalls.in).not.toHaveBeenCalled();
    expect(leadsCalls.order).toHaveBeenCalledWith('won_at', { ascending: false });
    expect(leadsCalls.limit).toHaveBeenCalledWith(50);
    expect(pushConfirmedMeetingToCrm).toHaveBeenCalledTimes(2);
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalledWith(ORG, LEAD_PENDING);
    expect(json.notFound).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const leadEvent = vi.hoisted(() => ({ logLeadEvent: vi.fn(), logLeadEventBulk: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvent);
vi.mock('@/lib/actions/handle-error', () => ({
  handleQueryError: (err: unknown) => (err ? { success: false, error: 'db error' } : null),
}));

import { switchLeadsCadence } from './manage-cadences';

const CAD = '33333333-3333-3333-3333-333333333333';
const LEAD = '44444444-4444-4444-4444-444444444444';

let cadenceRow: unknown;
let priorEnrollments: unknown[];
const updates: Array<Record<string, unknown>> = [];
const inserts: Array<Record<string, unknown>> = [];

function makeChain(table = '') {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    updates.push(payload);
    return chain;
  });
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    inserts.push(row);
    return Promise.resolve({ error: null });
  });
  chain.in = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: cadenceRow, error: null }));
  // Awaitable: o select de priorEnrollments e o update de encerramento terminam
  // com `.in(...)` e são aguardados direto — a resposta serve para os dois.
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: table === 'leads' ? [{ id: LEAD }] : priorEnrollments, error: null }).then(resolve, reject);
  return chain;
}

const supabase = { from: (table: string) => makeChain(table) };

function asRole(role: 'manager' | 'sdr') {
  auth.getAuthOrgIdResult.mockResolvedValue({
    success: true,
    data: { orgId: 'org-1', userId: 'u1', role, supabase },
  });
}

describe('switchLeadsCadence — guard-rails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    inserts.length = 0;
    cadenceRow = { id: CAD, status: 'active', name: 'Reativação', sdr_switch_allowed: true };
    priorEnrollments = [{ lead_id: LEAD }];
  });

  it('SDR não move lead para cadência com sdr_switch_allowed=false (FORBIDDEN)', async () => {
    asRole('sdr');
    cadenceRow = { ...(cadenceRow as object), sdr_switch_allowed: false };

    const result = await switchLeadsCadence(CAD, [LEAD], { reason: 'wrong_cadence' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('FORBIDDEN');
    // Nada encerrado, nada inscrito.
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('manager move mesmo com sdr_switch_allowed=false', async () => {
    asRole('manager');
    cadenceRow = { ...(cadenceRow as object), sdr_switch_allowed: false };

    const result = await switchLeadsCadence(CAD, [LEAD], { reason: 'wrong_cadence' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enrolled).toBe(1);
  });

  it('SDR move quando a flag está true (default) e grava switch_reason', async () => {
    asRole('sdr');

    const result = await switchLeadsCadence(CAD, [LEAD], { reason: 'wrong_cadence', note: 'era inbound' });
    expect(result.success).toBe(true);

    expect(leadEvent.logLeadEventBulk).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        event: 'cadence_switched',
        leadIds: [LEAD],
        metadata: expect.objectContaining({ cadence_id: CAD, switch_reason: 'wrong_cadence', switch_note: 'era inbound' }),
      }),
    );
    const msg = (leadEvent.logLeadEventBulk.mock.calls[0]?.[1] as { message: string }).message;
    expect(msg).toContain('Motivo: wrong_cadence');
    expect(msg).toContain('Obs: era inbound');
  });

  it('sem motivo (fluxo legado/bulk) continua funcionando, com switch_reason null', async () => {
    asRole('manager');

    const result = await switchLeadsCadence(CAD, [LEAD]);
    expect(result.success).toBe(true);
    expect(leadEvent.logLeadEventBulk).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ metadata: expect.objectContaining({ switch_reason: null }) }),
    );
  });

  it('motivo fora da lista ou observação longa é recusado antes de tocar no banco (QA SEC-001)', async () => {
    asRole('manager');

    const bad = await switchLeadsCadence(CAD, [LEAD], { reason: 'porque sim' });
    expect(bad.success).toBe(false);

    const long = await switchLeadsCadence(CAD, [LEAD], { reason: 'other', note: 'x'.repeat(200) });
    expect(long.success).toBe(false);

    expect(auth.getAuthOrgIdResult).not.toHaveBeenCalled();
  });

  it('cadência inativa continua recusada', async () => {
    asRole('manager');
    cadenceRow = { ...(cadenceRow as object), status: 'paused' };
    const result = await switchLeadsCadence(CAD, [LEAD]);
    expect(result.success).toBe(false);
  });
});

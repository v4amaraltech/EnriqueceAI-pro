import { beforeEach, describe, expect, it, vi } from 'vitest';

import { from } from '@/lib/supabase/from';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import { ingestInboundLeads } from './inbound-lead.service';

// Mock the supabase query wrapper and the fire-and-forget side effects so the
// test exercises the dedup logic without touching a real DB.
vi.mock('@/lib/supabase/from', () => ({ from: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({
  dispatchWebhookEvent: vi.fn(() => Promise.resolve()),
}));
// O serviço faz `import()` fire-and-forget deste módulo quando o lead tem dono.
// Sem o mock, o import real (cliente service role do Supabase) ficava pendente
// quando o worker do Vitest fechava — "Closing rpc while fetch was pending" no CI.
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

const CHAINABLE = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'ilike', 'like', 'is', 'in', 'order', 'limit',
] as const;

/** Build a chainable query-builder whose `single`/`maybeSingle` resolve `terminal`. */
function makeBuilder(terminal: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of CHAINABLE) b[m] = vi.fn(() => b);
  b.single = vi.fn(() => Promise.resolve(terminal));
  b.maybeSingle = vi.fn(() => Promise.resolve(terminal));
  b.then = (resolve: (v: unknown) => unknown) => resolve(terminal);
  return b;
}

const fromMock = vi.mocked(from);

const baseLead = {
  first_name: 'Carlos',
  email: 'carlos@empresa.com',
  telefone: '+5511999999999',
  empresa: 'XPTO',
};

const options = {
  orgId: 'org-1',
  supabase: {} as never,
  defaultSource: 'webhook' as const,
  onDuplicate: 'skip' as const,
};

beforeEach(() => {
  fromMock.mockReset();
});

describe('ingestInboundLeads — intra-batch dedup', () => {
  it('does not insert twice when the same email appears twice in one batch', async () => {
    fromMock
      // checkLeadLimitForOrg → no subscription → allowed
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // lead 0: findExistingLeadId (email) → not found
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // lead 0: insert → created
      .mockReturnValueOnce(makeBuilder({ data: { id: 'lead-1' }, error: null }) as never);

    const result = await ingestInboundLeads([{ ...baseLead }, { ...baseLead }], options);

    expect(result.created).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.results[1]).toMatchObject({ status: 'duplicate', existing_lead_id: 'lead-1' });
    // 3 queries only: limit check + 1 find + 1 insert. The primary contact is
    // created by a DB trigger (not app code), and the 2nd lead dedups in-memory.
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});

describe('ingestInboundLeads — concurrent race (unique violation)', () => {
  it('treats a 23505 unique violation as a duplicate instead of an error', async () => {
    fromMock
      // checkLeadLimitForOrg → allowed
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // findExistingLeadId (pre-insert) → not found
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // insert → unique violation (another request won the race)
      .mockReturnValueOnce(makeBuilder({ data: null, error: { code: '23505' } }) as never)
      // race fallback findExistingLeadId → now resolves the winner
      .mockReturnValueOnce(makeBuilder({ data: { id: 'raced-1' } }) as never);

    const result = await ingestInboundLeads([{ ...baseLead }], options);

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.results[0]).toMatchObject({ status: 'duplicate', existing_lead_id: 'raced-1' });
  });
});

describe('ingestInboundLeads — histórico da inscrição em cadência', () => {
  it('registra cadence_enrolled na timeline quando o lead entra na cadência', async () => {
    fromMock
      // checkLeadLimitForOrg → allowed
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // findExistingLeadId → not found
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // insert lead → created
      .mockReturnValueOnce(makeBuilder({ data: { id: 'lead-9' }, error: null }) as never)
      // enrollInCadence: cadence lookup → ativa
      .mockReturnValueOnce(makeBuilder({ data: { id: '11111111-1111-4111-8111-111111111111', name: 'Inbound 2.0', status: 'active' } }) as never)
      // enrollInCadence: insert enrollment → ok
      .mockReturnValueOnce(makeBuilder({ error: null }) as never);

    const result = await ingestInboundLeads(
      [{ ...baseLead, cadence_id: '11111111-1111-4111-8111-111111111111', assigned_to: '22222222-2222-4222-8222-222222222222' }],
      options,
    );

    expect(result.created).toBe(1);
    expect(result.results[0]).toMatchObject({ enrolled: true });
    expect(vi.mocked(logLeadEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leadId: 'lead-9',
        event: 'cadence_enrolled',
        message: 'Inscrito na cadência: Inbound 2.0',
      }),
    );
  });
});

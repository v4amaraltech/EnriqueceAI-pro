import { describe, expect, it, vi } from 'vitest';

import { findLeadByPhoneService, findUserByExtension } from './external-call.service';

interface MockSupabase {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
}

function createMockSupabase(opts: {
  rpcResult?: string | null;
  tables?: Record<string, unknown[]>;
} = {}): { client: MockSupabase; rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> } {
  const tables = opts.tables ?? {};
  const chain: Record<string, unknown> = {};
  let currentTable = '';

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.like = vi.fn().mockReturnValue(chain);
  chain.gt = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockImplementation(() => {
    const data = tables[currentTable];
    return Promise.resolve({ data: data?.[0] ?? null });
  });

  const from = vi.fn((table: string) => {
    currentTable = table;
    return chain;
  });

  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcResult ?? null });

  return { client: { rpc, from } as MockSupabase, rpc, from };
}

describe('findLeadByPhoneService', () => {
  it('returns null for short phone numbers (skips RPC)', async () => {
    const { client, rpc } = createMockSupabase();
    const result = await findLeadByPhoneService(
      client as unknown as Parameters<typeof findLeadByPhoneService>[0],
      'org-1',
      '1234',
    );
    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null when RPC returns no lead', async () => {
    const { client } = createMockSupabase({ rpcResult: null });
    const result = await findLeadByPhoneService(
      client as unknown as Parameters<typeof findLeadByPhoneService>[0],
      'org-1',
      '11999887766',
    );
    expect(result).toBeNull();
  });

  it('calls find_lead_id_by_phone RPC with normalized digits and sdrUserId', async () => {
    const { client, rpc } = createMockSupabase({
      rpcResult: 'lead-1',
      tables: { cadence_enrollments: [] },
    });
    const result = await findLeadByPhoneService(
      client as unknown as Parameters<typeof findLeadByPhoneService>[0],
      'org-1',
      '(11) 99988-7766',
      'sdr-1',
    );
    expect(rpc).toHaveBeenCalledWith('find_lead_id_by_phone', {
      p_org_id: 'org-1',
      p_phone_digits: '11999887766',
      p_sdr_user_id: 'sdr-1',
    });
    expect(result?.leadId).toBe('lead-1');
  });

  it('passes null sdrUserId when omitted', async () => {
    const { client, rpc } = createMockSupabase({
      rpcResult: 'lead-1',
      tables: { cadence_enrollments: [] },
    });
    await findLeadByPhoneService(
      client as unknown as Parameters<typeof findLeadByPhoneService>[0],
      'org-1',
      '11999887766',
    );
    expect(rpc).toHaveBeenCalledWith(
      'find_lead_id_by_phone',
      expect.objectContaining({ p_sdr_user_id: null }),
    );
  });

  it('includes enrollment data when lead has active cadence', async () => {
    const chain: Record<string, unknown> = {};
    let currentTable = '';
    const callCount = { cadence_enrollments: 0, cadence_steps: 0 };
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.like = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockImplementation(() => {
      if (currentTable === 'cadence_enrollments' && callCount.cadence_enrollments === 0) {
        callCount.cadence_enrollments++;
        return Promise.resolve({ data: { id: 'enr-1', cadence_id: 'cad-1', current_step: 2 } });
      }
      if (currentTable === 'cadence_steps' && callCount.cadence_steps === 0) {
        callCount.cadence_steps++;
        return Promise.resolve({ data: { id: 'step-1', channel: 'phone' } });
      }
      return Promise.resolve({ data: null });
    });

    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 'lead-1' }),
      from: vi.fn((table: string) => {
        currentTable = table;
        return chain;
      }),
    };

    const result = await findLeadByPhoneService(
      client as unknown as Parameters<typeof findLeadByPhoneService>[0],
      'org-1',
      '11999887766',
    );
    expect(result?.leadId).toBe('lead-1');
    expect(result?.enrollmentId).toBe('enr-1');
    expect(result?.stepChannel).toBe('phone');
  });
});

describe('findUserByExtension', () => {
  it('finds user by ramal', async () => {
    const { client } = createMockSupabase({
      tables: { api4com_connections: [{ user_id: 'user-1', org_id: 'org-1' }] },
    });
    const result = await findUserByExtension(
      client as unknown as Parameters<typeof findUserByExtension>[0],
      '1033',
    );
    expect(result).toEqual({ userId: 'user-1', orgId: 'org-1' });
  });

  it('returns null for unknown ramal', async () => {
    const { client } = createMockSupabase({});
    const result = await findUserByExtension(
      client as unknown as Parameters<typeof findUserByExtension>[0],
      '9999',
    );
    expect(result).toBeNull();
  });
});

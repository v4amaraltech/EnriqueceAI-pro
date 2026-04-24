import { describe, expect, it, vi } from 'vitest';

import { findLeadByPhoneService, findUserByExtension } from './external-call.service';

function createMockSupabase(results: Record<string, unknown[]> = {}) {
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
    const data = results[currentTable];
    return Promise.resolve({ data: data?.[0] ?? null });
  });

  const from = vi.fn((table: string) => {
    currentTable = table;
    return chain;
  });

  return { client: { from } as unknown as Parameters<typeof findLeadByPhoneService>[0], from, chain };
}

describe('findLeadByPhoneService', () => {
  it('returns null for short phone numbers', async () => {
    const { client } = createMockSupabase();
    const result = await findLeadByPhoneService(client, 'org-1', '1234');
    expect(result).toBeNull();
  });

  it('finds lead by telefone field', async () => {
    const { client } = createMockSupabase({
      leads: [{ id: 'lead-1' }],
    });
    const result = await findLeadByPhoneService(client, 'org-1', '11999887766');
    expect(result).not.toBeNull();
    expect(result?.leadId).toBe('lead-1');
  });

  it('returns null when no lead matches', async () => {
    const { client } = createMockSupabase({
      leads: [],
    });
    const result = await findLeadByPhoneService(client, 'org-1', '11999887766');
    expect(result).toBeNull();
  });

  it('includes enrollment data when lead has active cadence', async () => {
    const callCount = { leads: 0, cadence_enrollments: 0, cadence_steps: 0 };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.like = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockImplementation(() => {
      // Return different data based on call sequence
      if (callCount.leads === 0) {
        callCount.leads++;
        return Promise.resolve({ data: { id: 'lead-1' } });
      }
      if (callCount.cadence_enrollments === 0) {
        callCount.cadence_enrollments++;
        return Promise.resolve({ data: { id: 'enr-1', cadence_id: 'cad-1', current_step: 2 } });
      }
      if (callCount.cadence_steps === 0) {
        callCount.cadence_steps++;
        return Promise.resolve({ data: { id: 'step-1', channel: 'phone' } });
      }
      return Promise.resolve({ data: null });
    });

    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as Parameters<typeof findLeadByPhoneService>[0];

    const result = await findLeadByPhoneService(client, 'org-1', '11999887766');
    expect(result?.leadId).toBe('lead-1');
    expect(result?.enrollmentId).toBe('enr-1');
    expect(result?.stepChannel).toBe('phone');
  });
});

describe('findUserByExtension', () => {
  it('finds user by ramal', async () => {
    const { client } = createMockSupabase({
      api4com_connections: [{ user_id: 'user-1', org_id: 'org-1' }],
    });
    const result = await findUserByExtension(client, '1033');
    expect(result).toEqual({ userId: 'user-1', orgId: 'org-1' });
  });

  it('returns null for unknown ramal', async () => {
    const { client } = createMockSupabase({});
    const result = await findUserByExtension(client, '9999');
    expect(result).toBeNull();
  });
});

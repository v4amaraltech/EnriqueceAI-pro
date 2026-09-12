import { describe, expect, it, vi } from 'vitest';

import { fetchSaoByLead } from './sao-feedback.service';

function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(finalResult).then(resolve);
  for (const method of ['select', 'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

const ORG = 'org-1';

describe('fetchSaoByLead', () => {
  it('não consulta o banco sem leadIds', async () => {
    const supabase = { from: vi.fn() };
    const map = await fetchSaoByLead(supabase as never, ORG, []);
    expect(map.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('lê closer_feedback_requests por org, só respondidos com SAO preenchido, e resolve por lead', async () => {
    const chain = createChainMock({
      data: [
        { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-09-09T10:00:00Z' },
        { lead_id: 'l1', oportunidade_qualificada: false, responded_at: '2026-09-11T10:00:00Z' },
        { lead_id: 'l2', oportunidade_qualificada: true, responded_at: '2026-09-10T10:00:00Z' },
      ],
    });
    const supabase = { from: vi.fn(() => chain) };

    const map = await fetchSaoByLead(supabase as never, ORG, ['l1', 'l2', 'l3']);

    expect(supabase.from).toHaveBeenCalledWith('closer_feedback_requests');
    expect(chain.eq).toHaveBeenCalledWith('org_id', ORG);
    expect(chain.not).toHaveBeenCalledWith('responded_at', 'is', null);
    expect(chain.not).toHaveBeenCalledWith('oportunidade_qualificada', 'is', null);
    expect(chain.in).toHaveBeenCalledWith('lead_id', ['l1', 'l2', 'l3']);
    expect(map.get('l1')).toBe(false);
    expect(map.get('l2')).toBe(true);
    expect(map.has('l3')).toBe(false);
  });

  it('quebra a lista de leads em chunks (limite de URL do PostgREST)', async () => {
    const chain = createChainMock({ data: [] });
    const supabase = { from: vi.fn(() => chain) };
    const ids = Array.from({ length: 450 }, (_, i) => `lead-${i}`);

    await fetchSaoByLead(supabase as never, ORG, ids);

    expect(chain.in).toHaveBeenCalledTimes(3); // 200 + 200 + 50
    const firstChunk = (chain.in as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(firstChunk).toHaveLength(200);
  });
});

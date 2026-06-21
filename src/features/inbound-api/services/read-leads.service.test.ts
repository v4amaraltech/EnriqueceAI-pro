import { beforeEach, describe, expect, it, vi } from 'vitest';

import { from } from '@/lib/supabase/from';

import { getLeadById, listLeads, toPublicLead } from './read-leads.service';

vi.mock('@/lib/supabase/from', () => ({ from: vi.fn() }));
const fromMock = vi.mocked(from);

interface BuilderConfig {
  rows?: Record<string, unknown>[];
  count?: number;
  single?: Record<string, unknown> | null;
}

function makeBuilder(cfg: BuilderConfig) {
  const eqCalls: [string, unknown][] = [];
  const rangeCalls: [number, number][] = [];
  const b: Record<string, unknown> = { eqCalls, rangeCalls };
  for (const m of ['select', 'is', 'in', 'gte', 'order']) b[m] = vi.fn(() => b);
  b.eq = vi.fn((col: string, val: unknown) => { eqCalls.push([col, val]); return b; });
  b.range = vi.fn((f: number, t: number) => {
    rangeCalls.push([f, t]);
    return Promise.resolve({ data: cfg.rows ?? [], count: cfg.count ?? 0 });
  });
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: cfg.single ?? null }));
  return b;
}

const sb = {} as never;

beforeEach(() => fromMock.mockReset());

describe('toPublicLead', () => {
  it('maps nome_fantasia → empresa and exposes only curated fields', () => {
    const dto = toPublicLead({
      id: 'l1', status: 'won', nome_fantasia: 'XPTO', first_name: 'Ana',
      fit_score: 80, won_by: 'user-x', custom_field_values: { a: 1 },
    });
    expect(dto.id).toBe('l1');
    expect(dto.empresa).toBe('XPTO');
    expect(dto.custom_fields).toEqual({ a: 1 });
    // internal columns are not leaked
    expect(dto).not.toHaveProperty('fit_score');
    expect(dto).not.toHaveProperty('won_by');
    expect(dto).not.toHaveProperty('nome_fantasia');
  });

  it('defaults custom_fields to {} and missing fields to null', () => {
    const dto = toPublicLead({ id: 'l2' });
    expect(dto.custom_fields).toEqual({});
    expect(dto.email).toBeNull();
    expect(dto.empresa).toBeNull();
  });
});

describe('listLeads', () => {
  it('scopes by org, applies status filter and offset pagination', async () => {
    const b = makeBuilder({ rows: [{ id: 'a' }, { id: 'b' }], count: 5 });
    fromMock.mockReturnValue(b as never);

    const res = await listLeads(sb, 'org-1', {
      page: 2, per_page: 50, status: ['new', 'contacted'],
    } as never);

    expect(res.total).toBe(5);
    expect(res.total_pages).toBe(1); // ceil(5/50)
    expect(res.page).toBe(2);
    expect(res.data).toHaveLength(2);
    // org scoping enforced in code (service role bypasses RLS)
    expect((b.eqCalls as [string, unknown][])).toContainEqual(['org_id', 'org-1']);
    // status filter applied + correct offset window (page 2 → 50..99)
    expect(b.in).toHaveBeenCalledWith('status', ['new', 'contacted']);
    expect((b.rangeCalls as [number, number][])[0]).toEqual([50, 99]);
  });

  it('omits the status filter when not provided', async () => {
    const b = makeBuilder({ rows: [], count: 0 });
    fromMock.mockReturnValue(b as never);

    await listLeads(sb, 'org-1', { page: 1, per_page: 50 } as never);
    expect(b.in).not.toHaveBeenCalled();
  });
});

describe('getLeadById', () => {
  it('returns the mapped lead when found', async () => {
    const b = makeBuilder({ single: { id: 'l1', nome_fantasia: 'Y' } });
    fromMock.mockReturnValue(b as never);

    const lead = await getLeadById(sb, 'org-1', 'l1');
    expect(lead?.id).toBe('l1');
    expect(lead?.empresa).toBe('Y');
    expect((b.eqCalls as [string, unknown][])).toContainEqual(['org_id', 'org-1']);
  });

  it('returns null when not found', async () => {
    const b = makeBuilder({ single: null });
    fromMock.mockReturnValue(b as never);
    expect(await getLeadById(sb, 'org-1', 'missing')).toBeNull();
  });
});

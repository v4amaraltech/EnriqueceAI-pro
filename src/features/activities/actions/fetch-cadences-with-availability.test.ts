import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/from', () => ({ from: vi.fn() }));

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { fetchCadencesWithAvailability } from './fetch-cadences-with-availability';

const SDR = 'sdr-1';
const OTHER_SDR = 'sdr-2';
const MANAGER = 'mgr-1';

const CADENCES = [
  { id: 'own', name: 'Minha', origin: 'outbound', total_steps: 4, priority: 'medium', created_by: SDR, executor: 'sdr' },
  { id: 'team', name: 'Inbound 2.0', origin: 'inbound_passive', total_steps: 6, priority: 'medium', created_by: MANAGER, executor: 'sdr' },
  { id: 'other', name: 'Do colega', origin: 'outbound', total_steps: 4, priority: 'medium', created_by: OTHER_SDR, executor: 'sdr' },
  { id: 'bdr', name: 'BDR IA — Arroz', origin: 'outbound', total_steps: 4, priority: 'medium', created_by: MANAGER, executor: 'bdr_ai' },
  { id: 'legacy', name: 'Sem criador', origin: 'outbound', total_steps: 4, priority: 'medium', created_by: null, executor: 'sdr' },
];

/** Chainable, awaitable query builder that resolves to a fixed result. */
function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'or', 'order', 'limit', 'in']) b[m] = () => b;
  b.single = () => Promise.resolve(result);
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return b;
}

function setup(role: 'sdr' | 'manager') {
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({
    success: true,
    data: { orgId: 'org-1', userId: role === 'sdr' ? SDR : MANAGER, role, supabase: {} as never },
  });
  let memberCall = 0;
  vi.mocked(from).mockImplementation(((_client: unknown, table: string) => {
    if (table === 'organization_members') {
      memberCall += 1;
      // 1st call: role of the current user; 2nd call: list of managers.
      return memberCall === 1
        ? builder({ data: { role } })
        : builder({ data: [{ user_id: MANAGER }] });
    }
    if (table === 'cadences') return builder({ data: CADENCES });
    return builder({ data: [], count: 0 });
  }) as never);
}

describe('fetchCadencesWithAvailability — cadências visíveis', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SDR vê as próprias e as do gestor, sem BDR IA nem as de outro SDR', async () => {
    setup('sdr');
    const res = await fetchCadencesWithAvailability();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.cadences.map((c) => c.id).sort()).toEqual(['legacy', 'own', 'team']);
  });

  it('gestor continua vendo todas as cadências ativas', async () => {
    setup('manager');
    const res = await fetchCadencesWithAvailability();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.cadences).toHaveLength(CADENCES.length);
  });
});

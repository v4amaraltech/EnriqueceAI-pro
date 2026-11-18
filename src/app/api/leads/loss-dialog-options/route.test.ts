import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ fetchLossReasons: vi.fn() }));
const cadences = vi.hoisted(() => ({ fetchActiveCadences: vi.fn() }));
vi.mock('@/features/leads/actions/lead-lifecycle', () => lifecycle);
vi.mock('@/features/leads/actions/fetch-active-cadences', () => cadences);

import { GET } from './route';

describe('GET /api/leads/loss-dialog-options', () => {
  beforeEach(() => {
    lifecycle.fetchLossReasons.mockReset();
    cadences.fetchActiveCadences.mockReset();
  });

  it('devolve motivos e cadências juntos, sem cache', async () => {
    const reasons = { success: true, data: [{ id: 'r1', name: 'Não ICP' }] };
    const active = { success: true, data: [{ id: 'c1', name: 'Inbound', total_steps: 5 }] };
    lifecycle.fetchLossReasons.mockResolvedValue(reasons);
    cadences.fetchActiveCadences.mockResolvedValue(active);
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ lossReasons: reasons, cadences: active });
  });

  it('repassa o erro de auth das leituras', async () => {
    const denied = { success: false, error: 'Não autenticado' };
    lifecycle.fetchLossReasons.mockResolvedValue(denied);
    cadences.fetchActiveCadences.mockResolvedValue(denied);
    expect(await (await GET()).json()).toEqual({ lossReasons: denied, cadences: denied });
  });
});

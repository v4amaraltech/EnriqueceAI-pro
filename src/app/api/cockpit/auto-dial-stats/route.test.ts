import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const action = vi.hoisted(() => ({ getAutoDialDayStatsAction: vi.fn() }));
vi.mock('@/features/cockpit/actions/auto-dial-stats', () => action);

describe('GET /api/cockpit/auto-dial-stats', () => {
  beforeEach(() => action.getAutoDialDayStatsAction.mockReset());

  it('devolve o resumo do usuário logado sem cache', async () => {
    const result = {
      success: true,
      data: { callsToday: 3, answeredToday: 1, ratePct: 33, dailyCap: 400, remaining: 397 },
    };
    action.getAutoDialDayStatsAction.mockResolvedValue(result);
    const res = await GET();
    expect(action.getAutoDialDayStatsAction).toHaveBeenCalledTimes(1);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(result);
  });

  it('repassa a falha da leitura', async () => {
    action.getAutoDialDayStatsAction.mockResolvedValue({
      success: false,
      error: 'Falha ao ler o resumo do dia',
    });
    const res = await GET();
    expect((await res.json()).success).toBe(false);
  });
});

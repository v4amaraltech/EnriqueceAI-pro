import { beforeEach, describe, expect, it, vi } from 'vitest';

const action = vi.hoisted(() => ({ getWebphoneCallOutcome: vi.fn() }));
vi.mock('@/features/calls/actions/get-webphone-call-outcome', () => action);

import { GET } from './route';

describe('GET /api/webphone/call-outcome', () => {
  beforeEach(() => action.getWebphoneCallOutcome.mockReset());

  it('repassa o callId da query para a leitura e devolve o resultado sem cache', async () => {
    const result = { success: true, data: { leadAnswer: 'answered' } };
    action.getWebphoneCallOutcome.mockResolvedValue(result);
    const res = await GET(new Request('http://x/api/webphone/call-outcome?callId=abc'));
    expect(action.getWebphoneCallOutcome).toHaveBeenCalledWith({ callId: 'abc' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(result);
  });

  it('sem callId cai na validação da leitura (Dados inválidos)', async () => {
    action.getWebphoneCallOutcome.mockResolvedValue({ success: false, error: 'Dados inválidos' });
    const res = await GET(new Request('http://x/api/webphone/call-outcome'));
    expect(action.getWebphoneCallOutcome).toHaveBeenCalledWith({ callId: null });
    expect((await res.json()).success).toBe(false);
  });
});

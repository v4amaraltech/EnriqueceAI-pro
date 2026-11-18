import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetLossDialogOptionsCache,
  fetchLossDialogOptions,
  getCachedLossDialogOptions,
} from './fetch-loss-dialog-options';

describe('fetchLossDialogOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetLossDialogOptionsCache();
  });

  it('consulta a rota GET (fora da fila de Server Actions) e guarda a lista', async () => {
    const body = {
      lossReasons: { success: true, data: [{ id: 'r1', name: 'Não ICP' }] },
      cadences: { success: true, data: [{ id: 'c1', name: 'Inbound', total_steps: 3 }] },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLossDialogOptions()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/loss-dialog-options', { cache: 'no-store' });
    expect(getCachedLossDialogOptions()).toEqual({
      lossReasons: body.lossReasons.data,
      cadences: body.cadences.data,
    });
  });

  it('não guarda nada quando os motivos falham', async () => {
    const body = { lossReasons: { success: false, error: 'x' }, cadences: { success: false, error: 'x' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    await fetchLossDialogOptions();
    expect(getCachedLossDialogOptions()).toBeNull();
  });

  it('devolve null em erro HTTP ou de rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));
    expect(await fetchLossDialogOptions()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchLossDialogOptions()).toBeNull();
  });
});

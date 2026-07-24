import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KommoAdapter } from './kommo.adapter';
import type { CrmCredentials } from '../types/crm';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('KommoAdapter.fetchPipelines', () => {
  let adapter: KommoAdapter;
  const credentials: CrmCredentials = {
    access_token: 'test-token',
    subdomain: 'v4amaral',
  };

  beforeEach(() => {
    adapter = new KommoAdapter();
    vi.clearAllMocks();
  });

  it('omite funis arquivados (is_archive=true)', async () => {
    // Excluir um funil com leads no Kommo o arquiva em vez de apagar; a API segue
    // devolvendo o registro. O seletor de destino não pode oferecer esses funis.
    mockFetch.mockResolvedValue(
      okJson({
        _embedded: {
          pipelines: [
            { id: 1, name: 'Funil de Vendas SP', sort: 1, is_archive: false },
            { id: 2, name: 'Deborah', sort: 2, is_archive: true },
            { id: 3, name: 'Ativação', sort: 3, is_archive: false },
            { id: 4, name: 'Mercado Livre', sort: 4, is_archive: true },
          ],
        },
      }),
    );

    const pipelines = await adapter.fetchPipelines(credentials);

    expect(pipelines).toEqual([
      { id: 1, name: 'Funil de Vendas SP' },
      { id: 3, name: 'Ativação' },
    ]);
  });

  it('mantém funis quando is_archive vem ausente (contas antigas)', async () => {
    mockFetch.mockResolvedValue(
      okJson({
        _embedded: {
          pipelines: [
            { id: 10, name: 'Funil sem flag', sort: 1 },
            { id: 11, name: 'Outro', sort: 2, is_archive: false },
          ],
        },
      }),
    );

    const pipelines = await adapter.fetchPipelines(credentials);

    expect(pipelines).toEqual([
      { id: 10, name: 'Funil sem flag' },
      { id: 11, name: 'Outro' },
    ]);
  });

  it('devolve lista vazia quando não há pipelines', async () => {
    mockFetch.mockResolvedValue(okJson({ _embedded: {} }));
    await expect(adapter.fetchPipelines(credentials)).resolves.toEqual([]);
  });

  it('exige subdomain', async () => {
    await expect(adapter.fetchPipelines({ access_token: 't' } as CrmCredentials)).rejects.toThrow(
      'Kommo subdomain missing',
    );
  });
});

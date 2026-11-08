import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KommoAdapter, KOMMO_WON_STATUS_ID } from './kommo.adapter';
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

describe('KommoAdapter.updateDealStatus', () => {
  let adapter: KommoAdapter;
  const credentials: CrmCredentials = {
    access_token: 'test-token',
    subdomain: 'v4amaral',
  };

  beforeEach(() => {
    adapter = new KommoAdapter();
    vi.clearAllMocks();
  });

  it('faz PATCH no deal enviando pipeline_id + status_id (ganho = 142)', async () => {
    // Marcar "Ganho" precisa MOVER o deal existente para a coluna de venda ganha
    // — não recriar. Kommo exige pipeline_id junto do status_id na mesma chamada.
    mockFetch.mockResolvedValue(okJson({ id: 26321091 }));

    await adapter.updateDealStatus(credentials, '26321091', 13390831, KOMMO_WON_STATUS_ID);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://v4amaral.kommo.com/api/v4/leads/26321091');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      pipeline_id: 13390831,
      status_id: 142,
    });
  });

  it('exige subdomain', async () => {
    await expect(
      adapter.updateDealStatus({ access_token: 't' } as CrmCredentials, '1', 1, 142),
    ).rejects.toThrow('Kommo subdomain missing');
  });
});

describe('KommoAdapter.exchangeCode (validação de subdomínio)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'attacker.example/x?',
    'attacker.example',
    'evil.com#',
    'a@evil.com',
    'x.evil.com/',
    'conta:443',
    '',
  ])('rejeita referer malicioso %s sem chamar fetch', async (referer) => {
    await expect(
      new KommoAdapter().exchangeCode('CODE', 'https://app.test/cb', referer),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('aceita conta.kommo.com e chama apenas *.kommo.com', async () => {
    mockFetch.mockResolvedValue(
      okJson({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    );
    const creds = await new KommoAdapter().exchangeCode('CODE', 'https://app.test/cb', 'Conta.kommo.com');
    expect(creds.subdomain).toBe('conta');
    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(url.hostname).toBe('conta.kommo.com');
  });

  it('refreshToken rejeita subdomínio persistido inválido', async () => {
    await expect(
      new KommoAdapter().refreshToken({ access_token: 'x', refresh_token: 'r', subdomain: 'evil.example/x?' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

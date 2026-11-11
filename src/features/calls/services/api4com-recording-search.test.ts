import { describe, expect, it, vi } from 'vitest';

import {
  BACKOFF_MAX_ATTEMPTS,
  SEARCH_MAX_WINDOW_PAGES,
  type SearchCall,
  type SearchDeps,
  getWithBackoff,
  retryWaitMs,
  searchRecordingCandidates,
} from './api4com-recording-search';

const BASE = 'https://api.api4com.com/api/v1';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    to: '5511999999999',
    from: '1001',
    // relógio da API4COM: BRT "disfarçado" de Z (3h antes do UTC real)
    started_at: '2026-11-11T07:00:00.000Z',
    duration: 365,
    record_url: 'https://s3.sa-east-1.amazonaws.com/pbx-prod-callface/r1.mp3',
    ...over,
  };
}

function page(data: unknown[], nextPage: number | null = null) {
  return { data, metadata: { nextPage } };
}

function makeDeps(fetchFn: SearchDeps['fetchFn']) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  return { deps: { fetchFn, sleep, apiKey: 'tok', baseUrl: BASE } satisfies SearchDeps, sleep };
}

function makeCall(over: Partial<SearchCall> = {}): SearchCall {
  return {
    destination: '5511999999999',
    origin: '1001',
    started_at: '2026-11-11T10:00:00.000Z',
    created_at: '2026-11-11T10:00:00.000Z',
    duration_seconds: 365,
    metadata: {},
    ...over,
  };
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const url of gen) out.push(url);
  return out;
}

const decodedWhere = (url: string) =>
  JSON.parse(decodeURIComponent(new URL(url).searchParams.get('filter')!)).where as Record<
    string,
    unknown
  >;

describe('searchRecordingCandidates', () => {
  it('busca pontual por api4com_call_id e alt_api4com_ids com filtro de id (não varre páginas)', async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const where = decodedWhere(String(url));
      if (where.id === 'A')
        return Promise.resolve(json(page([record({ id: 'A', record_url: 'https://x/a.mp3' })])));
      if (where.id === 'B')
        return Promise.resolve(json(page([record({ id: 'B', record_url: 'https://x/b.mp3' })])));
      return Promise.resolve(json(page([])));
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    const gen = searchRecordingCandidates(
      deps,
      makeCall({ metadata: { api4com_call_id: 'A', alt_api4com_ids: ['B'] } }),
    );
    const first = await gen.next();
    const second = await gen.next();

    expect([first.value, second.value]).toEqual(['https://x/a.mp3', 'https://x/b.mp3']);
    // parou antes da janela: só as duas buscas por id
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('janela de data: filtro started_at em BRT e pagina enquanto houver nextPage', async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const p = Number(new URL(String(url)).searchParams.get('page'));
      if (p === 1)
        return Promise.resolve(
          json(page([record({ id: 'x', to: '5511000000000', from: '2000', record_url: 'https://x/no.mp3' })], 2)),
        );
      if (p === 2) return Promise.resolve(json(page([record()], 3)));
      return Promise.resolve(
        json(page([record({ id: 'r3', record_url: 'https://x/p3.mp3' })], null)),
      );
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    const urls = await collect(searchRecordingCandidates(deps, makeCall()));

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(urls).toEqual([
      'https://s3.sa-east-1.amazonaws.com/pbx-prod-callface/r1.mp3',
      'https://x/p3.mp3',
    ]);
    const firstUrl = String(fetchFn.mock.calls[0]![0]);
    expect(new URL(firstUrl).searchParams.get('limit')).toBe('100');
    expect(decodedWhere(firstUrl)).toEqual({
      started_at: { gte: '2026-11-11T06:40:00.000Z', lte: '2026-11-11T07:20:00.000Z' },
    });
  });

  it('não passa do teto de páginas da janela', async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const p = Number(new URL(String(url)).searchParams.get('page'));
      return Promise.resolve(json(page([], p + 1)));
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    await collect(searchRecordingCandidates(deps, makeCall()));

    expect(fetchFn).toHaveBeenCalledTimes(SEARCH_MAX_WINDOW_PAGES);
  });

  it('só faz GET', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json(page([]))));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    await collect(
      searchRecordingCandidates(deps, makeCall({ metadata: { api4com_call_id: 'A' } })),
    );

    for (const [, init] of fetchFn.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.method).toBe('GET');
    }
  });
});

describe('getWithBackoff', () => {
  it('429 dispara backoff exponencial curto (1s, 2s) e depois dá certo', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const { deps, sleep } = makeDeps(fetchFn);

    const res = await getWithBackoff(deps, `${BASE}/calls`);

    expect(res?.ok).toBe(true);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('respeita Retry-After', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '7' } }))
      .mockResolvedValueOnce(json({}));
    const { deps, sleep } = makeDeps(fetchFn);

    await getWithBackoff(deps, `${BASE}/calls`);

    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('desiste depois do teto de tentativas', async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 429 })));
    const { deps } = makeDeps(fetchFn);

    const res = await getWithBackoff(deps, `${BASE}/calls`);

    expect(res).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(BACKOFF_MAX_ATTEMPTS);
  });

  it('erro que não é de limite não retenta', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const { deps, sleep } = makeDeps(fetchFn);

    expect(await getWithBackoff(deps, `${BASE}/calls`)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('retryWaitMs', () => {
  it('lê segundos, RateLimit-Reset e data HTTP', () => {
    expect(retryWaitMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(retryWaitMs(new Headers({ 'ratelimit-reset': '2' }))).toBe(2000);
    const now = Date.parse('2026-11-11T10:00:00Z');
    expect(retryWaitMs(new Headers({ 'retry-after': 'Wed, 11 Nov 2026 10:00:05 GMT' }), now)).toBe(
      5000,
    );
    expect(retryWaitMs(new Headers())).toBeNull();
  });
});

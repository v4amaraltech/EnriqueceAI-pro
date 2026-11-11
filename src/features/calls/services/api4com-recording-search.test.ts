import { describe, expect, it, vi } from 'vitest';

import { SlidingWindowRateLimiter } from '@/features/integrations/services/api4com-rate-limit';

import {
  BACKOFF_MAX_ATTEMPTS,
  type RecordingSearchEvent,
  SEARCH_MAX_WINDOW_PAGES,
  type SearchCall,
  type SearchDeps,
  getWithBackoff,
  retryWaitMs,
  samePhone,
  searchRecordingCandidates,
  selectWindowCandidates,
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

/** Formato atual da API4COM: paginação em `meta`. */
function page(data: unknown[], nextPage: number | null = null) {
  return { data, meta: { nextPage } };
}

function fakeClock() {
  let t = 0;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  return { now: () => t, sleep };
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

async function collect(gen: AsyncGenerator<RecordingSearchEvent>) {
  const out: string[] = [];
  for await (const event of gen) if (event.kind === 'candidate') out.push(event.url);
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

    expect([first.value, second.value]).toEqual([
      { kind: 'candidate', url: 'https://x/a.mp3', phase: 'id', match: 'provider_id' },
      { kind: 'candidate', url: 'https://x/b.mp3', phase: 'id', match: 'provider_id' },
    ]);
    // parou antes da janela: só as duas buscas por id
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('janela de data: filtro started_at em BRT e pagina enquanto houver nextPage', async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const p = Number(new URL(String(url)).searchParams.get('page'));
      if (p === 1)
        return Promise.resolve(
          json(
            page(
              [
                record({
                  id: 'x',
                  to: '5511000000000',
                  from: '2000',
                  record_url: 'https://x/no.mp3',
                }),
              ],
              2,
            ),
          ),
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

  it('pagina por meta.nextPage; metadata só como fallback', async () => {
    const pagesSeen: number[] = [];
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const p = Number(new URL(String(url)).searchParams.get('page'));
      pagesSeen.push(p);
      if (p === 1) return Promise.resolve(json({ data: [], meta: { nextPage: 2 } }));
      // resposta antiga, sem meta: segue pelo metadata
      if (p === 2) return Promise.resolve(json({ data: [], metadata: { nextPage: 3 } }));
      // meta diz fim e prevalece sobre metadata
      return Promise.resolve(
        json({ data: [], meta: { nextPage: null }, metadata: { nextPage: 4 } }),
      );
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    await collect(searchRecordingCandidates(deps, makeCall()));

    expect(pagesSeen).toEqual([1, 2, 3]);
  });

  it('id do provedor antes da janela, e a janela só se o id não resolveu', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(json(page([])));
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    await collect(
      searchRecordingCandidates(deps, makeCall({ metadata: { api4com_call_id: 'A' } })),
    );

    expect(decodedWhere(urls[0]!)).toEqual({ id: 'A' });
    expect(decodedWhere(urls[1]!)).toHaveProperty('started_at');
  });

  it('API falhou: avisa lookup_failed e, com a janela incompleta, não aceita candidato único', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(page([record({ id: 'u', to: '' })], 2)))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    const events: RecordingSearchEvent[] = [];
    for await (const e of searchRecordingCandidates(deps, makeCall())) events.push(e);

    expect(events).toEqual([{ kind: 'lookup_failed', phase: 'window' }]);
  });

  it('janela incompleta ainda entrega o candidato pelo fone de destino', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(page([record()], 2)))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    const events: RecordingSearchEvent[] = [];
    for await (const e of searchRecordingCandidates(deps, makeCall())) events.push(e);

    expect(events.map((e) => e.kind)).toEqual(['candidate', 'lookup_failed']);
  });

  it('falha na busca por id avisa e segue para a janela', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(json(page([record()])));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);

    const events: RecordingSearchEvent[] = [];
    for await (const e of searchRecordingCandidates(
      deps,
      makeCall({ metadata: { api4com_call_id: 'A' } }),
    ))
      events.push(e);

    expect(events.map((e) => e.kind)).toEqual(['lookup_failed', 'candidate']);
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

describe('samePhone', () => {
  it('normaliza DDI, zero à esquerda, máscara e nono dígito', () => {
    expect(samePhone('+55 (11) 99999-9999', '11999999999')).toBe(true);
    expect(samePhone('011999999999', '5511999999999')).toBe(true);
    expect(samePhone('1199999999', '11999999999')).toBe(true); // sem o nono dígito
    expect(samePhone('5511999999999', '5511888888888')).toBe(false);
    expect(samePhone('1001', '5511999999999')).toBeNull(); // ramal: não comparável
    expect(samePhone('', '5511999999999')).toBeNull();
  });
});

describe('selectWindowCandidates (janela: ramal sozinho não basta)', () => {
  // ramal 1001 e horário batem; o fone de destino decide
  const other = (id: string, to: string) =>
    record({ id, to, record_url: `https://x/${id}.mp3` }) as never;

  it('aceita o candidato cujo fone de destino bate, mesmo com outros do ramal na janela', () => {
    const events = selectWindowCandidates(
      [
        other('o1', '5511888888888'),
        other('mine', '+55 11 99999-9999'),
        other('o2', '5511777777777'),
      ],
      makeCall(),
    );
    expect(events).toEqual([
      { kind: 'candidate', url: 'https://x/mine.mp3', phase: 'window', match: 'destination' },
    ]);
  });

  it('candidato único na janela sem fone que contradiga: aceito', () => {
    const events = selectWindowCandidates([other('u', '')], makeCall());
    expect(events).toEqual([
      { kind: 'candidate', url: 'https://x/u.mp3', phase: 'window', match: 'unique_in_window' },
    ]);
  });

  it('vários candidatos só pelo ramal: ambíguo, nenhuma URL', () => {
    const events = selectWindowCandidates(
      [other('a', '5511888888888'), other('b', '5511777777777'), other('c', '')],
      makeCall(),
    );
    expect(events).toEqual([{ kind: 'ambiguous_window', candidates: 3 }]);
  });

  it('candidato único, mas com fone de outro lead: ambíguo, não aceita', () => {
    const events = selectWindowCandidates([other('a', '5511888888888')], makeCall());
    expect(events).toEqual([{ kind: 'ambiguous_window', candidates: 1 }]);
  });

  it('registro com o id da própria ligação não conta como concorrente', () => {
    const events = selectWindowCandidates(
      [record({ id: 'own', to: '', record_url: null }) as never, other('u', '')],
      makeCall({ metadata: { api4com_call_id: 'own' } }),
    );
    expect(events).toEqual([
      { kind: 'candidate', url: 'https://x/u.mp3', phase: 'window', match: 'unique_in_window' },
    ]);
  });

  it('fora do horário ou da duração não é candidato', () => {
    const events = selectWindowCandidates(
      [
        record({ id: 'late', to: '', started_at: '2026-11-11T07:30:00.000Z' }) as never,
        record({ id: 'short', to: '', duration: 10 }) as never,
      ],
      makeCall(),
    );
    expect(events).toEqual([]);
  });

  it('searchRecordingCandidates repassa o aviso de janela ambígua', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(json(page([other('a', '5511888888888'), other('b', '5511777777777')]))),
    );
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch);
    const events: RecordingSearchEvent[] = [];
    for await (const e of searchRecordingCandidates(deps, makeCall())) events.push(e);
    expect(events).toEqual([{ kind: 'ambiguous_window', candidates: 2 }]);
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

describe('getWithBackoff com limitador (15 GET /calls por minuto)', () => {
  function limitedDeps(fetchFn: SearchDeps['fetchFn'], perMinute = 15, waitBudgetMs?: number) {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(perMinute, 60_000, clock);
    const deps: SearchDeps = {
      fetchFn,
      sleep: clock.sleep,
      apiKey: 'tok',
      baseUrl: BASE,
      limiter,
      now: clock.now,
      waitBudgetMs,
    };
    return { deps, clock };
  }

  it('40 requisições nunca passam de 15 em qualquer minuto', async () => {
    const { deps, clock } = limitedDeps(vi.fn(() => Promise.resolve(json(page([])))));
    const stamps: number[] = [];
    const fetchFn = deps.fetchFn;
    deps.fetchFn = ((...a: Parameters<typeof fetch>) => {
      stamps.push(clock.now());
      return fetchFn(...a);
    }) as typeof fetch;

    for (let i = 0; i < 40; i++) expect(await getWithBackoff(deps, `${BASE}/calls`)).not.toBeNull();

    for (const t of stamps) {
      expect(stamps.filter((s) => s >= t && s < t + 60_000).length).toBeLessThanOrEqual(15);
    }
  });

  it('429 com RateLimit-Reset pausa o token e repete depois do reset', async () => {
    const stamps: number[] = [];
    const responses = [
      new Response(null, { status: 429, headers: { 'RateLimit-Reset': '42' } }),
      json({ ok: true }),
    ];
    const { deps, clock } = limitedDeps(
      vi.fn(() => {
        stamps.push(clock.now());
        return Promise.resolve(responses.shift()!);
      }),
    );

    const res = await getWithBackoff(deps, `${BASE}/calls`);

    expect(res?.ok).toBe(true);
    expect(stamps).toEqual([0, 42_000]);
  });

  it('429 com Retry-After também vale para a próxima requisição do token', async () => {
    const stamps: number[] = [];
    const responses = [
      new Response(null, { status: 429, headers: { 'Retry-After': '10' } }),
      json({}),
      json({}),
    ];
    const { deps, clock } = limitedDeps(
      vi.fn(() => {
        stamps.push(clock.now());
        return Promise.resolve(responses.shift()!);
      }),
    );

    await getWithBackoff(deps, `${BASE}/calls`);
    await getWithBackoff(deps, `${BASE}/calls`);

    expect(stamps).toEqual([0, 10_000, 10_000]);
  });

  it('RateLimit-Remaining 0 pausa antes de estourar', async () => {
    const stamps: number[] = [];
    const responses = [
      json({}, { headers: { 'RateLimit-Remaining': '0', 'RateLimit-Reset': '30' } }),
      json({}),
    ];
    const { deps, clock } = limitedDeps(
      vi.fn(() => {
        stamps.push(clock.now());
        return Promise.resolve(responses.shift()!);
      }),
    );

    await getWithBackoff(deps, `${BASE}/calls`);
    await getWithBackoff(deps, `${BASE}/calls`);

    expect(stamps).toEqual([0, 30_000]);
  });

  it('sem cabeçalho, backoff exponencial via limitador (1s, 2s)', async () => {
    const stamps: number[] = [];
    const responses = [
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
      json({}),
    ];
    const { deps, clock } = limitedDeps(
      vi.fn(() => {
        stamps.push(clock.now());
        return Promise.resolve(responses.shift()!);
      }),
    );

    expect(await getWithBackoff(deps, `${BASE}/calls`)).not.toBeNull();
    expect(stamps).toEqual([0, 1_000, 3_000]);
  });

  it('orçamento de espera curto: desiste em vez de esperar o limite', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json({})));
    const { deps, clock } = limitedDeps(fetchFn, 1, 8_000);

    expect(await getWithBackoff(deps, `${BASE}/calls`)).not.toBeNull();
    expect(await getWithBackoff(deps, `${BASE}/calls`)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(0);
  });
});

describe('retryWaitMs', () => {
  it('RateLimit-Reset em epoch (segundos) vira espera relativa', () => {
    const now = Date.parse('2026-11-11T10:00:00Z');
    const epoch = String(Math.floor(now / 1000) + 25);
    expect(retryWaitMs(new Headers({ 'ratelimit-reset': epoch }), now)).toBe(25_000);
  });

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

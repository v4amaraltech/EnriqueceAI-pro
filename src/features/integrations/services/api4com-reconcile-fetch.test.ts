import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CallsRateLimiter } from './api4com-rate-limit';
import {
  RECONCILE_MAX_RATE_LIMIT_RETRIES,
  RECONCILE_RATE_LIMIT_FALLBACK_MS,
  RECONCILE_RATE_LIMIT_MAX_WAIT_MS,
  fetchReconcileCallsPage,
  rateLimitWaitMs,
} from './api4com-reconcile-fetch';

const URL_PAGE = 'https://api.api4com.com/api/v1/calls?page=1';

function fakeLimiter(log: string[] = []) {
  const limiter = {
    acquire: vi.fn(async () => {
      log.push('acquire');
      return true;
    }),
    pauseFor: vi.fn((ms: number) => {
      log.push(`pause:${ms}`);
    }),
  } satisfies CallsRateLimiter;
  return limiter;
}

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 200 ? '{"data":[]}' : 'x', { status, headers });
}

describe('fetchReconcileCallsPage', () => {
  it('reserva uma vaga no limitador antes de cada GET /calls', async () => {
    const log: string[] = [];
    const limiter = fakeLimiter(log);
    const fetchFn = vi.fn(async () => {
      log.push('fetch');
      return response(200);
    });

    const result = await fetchReconcileCallsPage({ fetchFn: fetchFn as unknown as typeof fetch, limiter }, URL_PAGE, 'tok');

    expect(result.kind).toBe('response');
    expect(log).toEqual(['acquire', 'fetch']);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
  });

  it('429 com RateLimit-Reset pausa o token por esse valor e tenta de novo', async () => {
    const log: string[] = [];
    const limiter = fakeLimiter(log);
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async () => {
        log.push('fetch');
        return response(429, { 'RateLimit-Reset': '12' });
      })
      .mockImplementationOnce(async () => {
        log.push('fetch');
        return response(200);
      });

    const result = await fetchReconcileCallsPage({ fetchFn, limiter }, URL_PAGE, 'tok');

    expect(result.kind).toBe('response');
    expect(limiter.pauseFor).toHaveBeenCalledWith(12_000);
    expect(log).toEqual(['acquire', 'fetch', 'pause:12000', 'acquire', 'fetch']);
  });

  it('429 com Retry-After também é honrado', async () => {
    const limiter = fakeLimiter();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(429, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(response(200));

    await fetchReconcileCallsPage({ fetchFn, limiter }, URL_PAGE, 'tok');

    expect(limiter.pauseFor).toHaveBeenCalledWith(7_000);
  });

  it('429 sem cabeçalho usa backoff e para depois do teto de tentativas', async () => {
    const limiter = fakeLimiter();
    const fetchFn = vi.fn().mockResolvedValue(response(429));

    const result = await fetchReconcileCallsPage({ fetchFn, limiter }, URL_PAGE, 'tok');

    expect(result).toEqual({ kind: 'rate_limited', attempts: RECONCILE_MAX_RATE_LIMIT_RETRIES + 1 });
    expect(fetchFn).toHaveBeenCalledTimes(RECONCILE_MAX_RATE_LIMIT_RETRIES + 1);
    expect(limiter.acquire).toHaveBeenCalledTimes(RECONCILE_MAX_RATE_LIMIT_RETRIES + 1);
    expect(limiter.pauseFor).toHaveBeenCalledTimes(RECONCILE_MAX_RATE_LIMIT_RETRIES);
    expect(limiter.pauseFor.mock.calls[0]![0]).toBe(RECONCILE_RATE_LIMIT_FALLBACK_MS);
  });

  it('outros erros HTTP voltam para o chamador sem retentativa', async () => {
    const limiter = fakeLimiter();
    const fetchFn = vi.fn().mockResolvedValue(response(401));

    const result = await fetchReconcileCallsPage({ fetchFn, limiter }, URL_PAGE, 'tok');

    expect(result.kind).toBe('response');
    expect(result.kind === 'response' && result.response.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(limiter.pauseFor).not.toHaveBeenCalled();
  });

  it('erro de rede vira fetch_failed', async () => {
    const limiter = fakeLimiter();
    const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));

    const result = await fetchReconcileCallsPage({ fetchFn, limiter }, URL_PAGE, 'tok');

    expect(result.kind).toBe('fetch_failed');
  });
});

describe('rateLimitWaitMs', () => {
  it('usa o cabeçalho e respeita o teto de ~1 min', () => {
    expect(rateLimitWaitMs(new Headers({ 'ratelimit-reset': '12' }), 0)).toBe(12_000);
    expect(rateLimitWaitMs(new Headers({ 'retry-after': '600' }), 0)).toBe(RECONCILE_RATE_LIMIT_MAX_WAIT_MS);
  });

  it('sem cabeçalho dobra a cada tentativa, com teto', () => {
    expect(rateLimitWaitMs(new Headers(), 0)).toBe(15_000);
    expect(rateLimitWaitMs(new Headers(), 1)).toBe(30_000);
    expect(rateLimitWaitMs(new Headers(), 2)).toBe(60_000);
    expect(rateLimitWaitMs(new Headers(), 3)).toBe(RECONCILE_RATE_LIMIT_MAX_WAIT_MS);
  });
});

describe('route do reconcile', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/api/workers/reconcile-api4com-calls/route.ts'),
    'utf8',
  );

  it('usa o limitador 15/min e não tem mais a pausa fixa de 500 ms (120 req/min)', () => {
    expect(source).toContain('getApi4ComCallsLimiter(apiKey)');
    expect(source).toContain('fetchReconcileCallsPage');
    expect(source).not.toMatch(/PAGE_DELAY_MS/);
    expect(source).not.toMatch(/120 req\/min/);
    expect(source).not.toMatch(/RATE_LIMIT_RETRY_MS/);
  });
});

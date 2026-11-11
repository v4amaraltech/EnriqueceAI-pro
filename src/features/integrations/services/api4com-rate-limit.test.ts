import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API4COM_CALLS_MAX_PER_MINUTE,
  SlidingWindowRateLimiter,
  api4comCallsPerMinute,
  clampCallsPerMinute,
  getApi4ComCallsLimiter,
  resetApi4ComCallsLimiters,
  setApi4ComCallsPerMinute,
} from './api4com-rate-limit';

function fakeClock() {
  let t = 0;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  return { now: () => t, sleep, advance: (ms: number) => (t += ms) };
}

afterEach(() => {
  resetApi4ComCallsLimiters();
  vi.unstubAllEnvs();
});

describe('SlidingWindowRateLimiter', () => {
  it('nunca passa de N reservas em qualquer janela de 60s', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(15, 60_000, clock);
    const stamps: number[] = [];
    for (let i = 0; i < 40; i++) {
      expect(await limiter.acquire()).toBe(true);
      stamps.push(clock.now());
    }
    for (const t of stamps) {
      expect(stamps.filter((s) => s >= t && s < t + 60_000).length).toBeLessThanOrEqual(15);
    }
    // as 15 primeiras saem na hora; a 16ª espera a janela
    expect(stamps[14]).toBe(0);
    expect(stamps[15]).toBe(60_000);
  });

  it('pauseFor segura todas as reservas até o fim da pausa', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(15, 60_000, clock);
    await limiter.acquire();
    limiter.pauseFor(42_000);
    await limiter.acquire();
    expect(clock.now()).toBe(42_000);
  });

  it('desiste sem esperar quando a espera passa do orçamento', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(1, 60_000, clock);
    expect(await limiter.acquire(0)).toBe(true);
    expect(await limiter.acquire(5_000)).toBe(false);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('pedidos concorrentes saem em fila, respeitando o teto', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(2, 60_000, clock);
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map(async () => {
        await limiter.acquire();
        order.push(clock.now());
      }),
    );
    expect(order).toEqual([0, 0, 60_000, 60_000]);
  });
});

describe('taxa configurável', () => {
  it('clamp: 1 a 15, inválido vira 15', () => {
    expect(clampCallsPerMinute(10)).toBe(10);
    expect(clampCallsPerMinute('5')).toBe(5);
    expect(clampCallsPerMinute(60)).toBe(API4COM_CALLS_MAX_PER_MINUTE);
    expect(clampCallsPerMinute(0)).toBe(15);
    expect(clampCallsPerMinute('abc')).toBe(15);
    expect(clampCallsPerMinute(undefined)).toBe(15);
  });

  it('lê API4COM_CALLS_PER_MINUTE, nunca acima de 15', () => {
    vi.stubEnv('API4COM_CALLS_PER_MINUTE', '6');
    expect(api4comCallsPerMinute()).toBe(6);
    vi.stubEnv('API4COM_CALLS_PER_MINUTE', '100');
    expect(api4comCallsPerMinute()).toBe(15);
  });

  it('um limitador por token; setApi4ComCallsPerMinute vale para os já criados', () => {
    const a = getApi4ComCallsLimiter('tok-a');
    expect(getApi4ComCallsLimiter('tok-a')).toBe(a);
    expect(getApi4ComCallsLimiter('tok-b')).not.toBe(a);
    expect(a.perWindow).toBe(15);
    expect(setApi4ComCallsPerMinute(8)).toBe(8);
    expect(a.perWindow).toBe(8);
    expect(getApi4ComCallsLimiter('tok-c').perWindow).toBe(8);
  });
});

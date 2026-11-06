import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETRY_DELAYS_MS, isNetworkError, withNetworkRetry } from './crm-network-retry';

/** `fetch failed` do undici: a causa (DNS/socket) fica em `cause.code`. */
function undiciError(code: string) {
  return new Error('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} x.kommo.com`), { code }) });
}

describe('isNetworkError', () => {
  it('reconhece DNS/socket do undici pelo cause.code', () => {
    expect(isNetworkError(undiciError('EAI_AGAIN'))).toBe(true);
    expect(isNetworkError(undiciError('ECONNRESET'))).toBe(true);
    expect(isNetworkError(undiciError('ENOTFOUND'))).toBe(true);
  });

  it('reconhece timeouts (AbortSignal.timeout e withTimeout)', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(isNetworkError(timeout)).toBe(true);
    expect(isNetworkError(new Error('Kommo pushDeal timed out after 15000ms'))).toBe(true);
  });

  it('reconhece a mensagem embrulhada pelo adapter', () => {
    expect(isNetworkError(new Error('Kommo fetch to https://x.kommo.com/oauth2 failed: fetch failed'))).toBe(true);
  });

  it('NÃO trata resposta da API (4xx/5xx) como rede', () => {
    expect(isNetworkError(new Error('Kommo API error (400): {"validation-errors":[]}'))).toBe(false);
    expect(isNetworkError(new Error('Kommo API error (401): unauthorized'))).toBe(false);
    expect(isNetworkError(new Error('Kommo API error (500): internal'))).toBe(false);
    expect(isNetworkError(new Error('Kommo: failed to create deal/lead, no ID returned'))).toBe(false);
    expect(isNetworkError('fetch failed')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('withNetworkRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('repete em erro de rede e devolve o resultado da tentativa que deu certo', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(undiciError('EAI_AGAIN'))
      .mockRejectedValueOnce(undiciError('ECONNRESET'))
      .mockResolvedValueOnce('ok');

    const promise = withNetworkRetry(fn, 'teste', { delaysMs: [10, 20, 30] });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('espera os intervalos do padrão (2s, 8s, 30s) entre as tentativas', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(undiciError('EAI_AGAIN'));
    const promise = withNetworkRetry(fn, 'teste');
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[0]!);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[1]!);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[2]!);
    expect(fn).toHaveBeenCalledTimes(4);

    await expect(promise).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('NÃO repete em erro 4xx do CRM', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('Kommo API error (400): bad request'));

    await expect(withNetworkRetry(fn, 'teste', { delaysMs: [0, 0, 0] })).rejects.toThrow('Kommo API error (400)');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sem política de repetição faz uma tentativa só', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(undiciError('EAI_AGAIN'));

    await expect(withNetworkRetry(fn, 'teste', { delaysMs: [] })).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

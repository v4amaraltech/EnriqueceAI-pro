import { describe, expect, it, vi } from 'vitest';

import {
  AssemblyAiError,
  createAssemblyAiClient,
  isRetryableNetworkError,
} from './assemblyai.client';
import { DURATION_MISMATCH_PREFIX, DURATION_WARNING_PREFIX } from './constants';
import { formatEngineError } from './errors';

const API_KEY = 'secret-assembly-key-123';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const COMPLETED = {
  id: 't1',
  status: 'completed',
  text: 'olá',
  audio_duration: 60,
  utterances: [{ speaker: 'A', text: 'olá', start: 0, end: 1 }],
};

/** fetch falso: cada rota consome uma fila de respostas (função = erro/lógica custom). */
function routedFetch(routes: Record<string, Array<(init: RequestInit) => Promise<Response>>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = url.endsWith('/upload')
      ? 'upload'
      : url.endsWith('/transcript')
        ? 'create'
        : 'poll';
    const queue = routes[key] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new Error(`rota inesperada ${url}`);
    return next(init);
  });
  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

const ok = (body: unknown) => async () => json(body);
const fail = (err: unknown) => async () => {
  throw err;
};
const econnreset = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });

describe('createAssemblyAiClient: timeout e retry', () => {
  it('falha de rede no upload (fetch failed / ECONNRESET) e depois sucesso: transcreve', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = routedFetch({
      upload: [fail(econnreset()), ok({ upload_url: 'https://cdn/u' })],
      create: [ok({ id: 't1', status: 'queued' })],
      poll: [ok(COMPLETED)],
    });
    const client = createAssemblyAiClient({ apiKey: API_KEY, fetchImpl: f.impl, sleep });
    const res = await client.transcribe(Buffer.from('x'));
    expect(res.text).toBe('olá');
    const uploads = f.calls.filter((c) => c.url.endsWith('/upload'));
    expect(uploads).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('erro com code ECONNRESET direto também é repetido', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = routedFetch({
      upload: [ok({ upload_url: 'https://cdn/u' })],
      create: [
        fail(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
        ok(COMPLETED),
      ],
    });
    const client = createAssemblyAiClient({ apiKey: API_KEY, fetchImpl: f.impl, sleep });
    await expect(client.transcribe(Buffer.from('x'))).resolves.toMatchObject({ text: 'olá' });
    expect(f.calls.filter((c) => c.url.endsWith('/transcript'))).toHaveLength(2);
  });

  it('toda requisição leva AbortSignal (upload, criação e poll)', async () => {
    const f = routedFetch({
      upload: [ok({ upload_url: 'https://cdn/u' })],
      create: [ok({ id: 't1', status: 'queued' })],
      poll: [ok(COMPLETED)],
    });
    const client = createAssemblyAiClient({
      apiKey: API_KEY,
      fetchImpl: f.impl,
      sleep: async () => undefined,
    });
    await client.transcribe(Buffer.from('x'));
    expect(f.calls).toHaveLength(3);
    for (const c of f.calls) expect(c.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout por requisição: após 3 tentativas rejeita com AssemblyAiError e cause de timeout', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    // Respeita o signal: só termina quando abortado pelo AbortSignal.timeout.
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const f = routedFetch({ upload: [hang] });
    const client = createAssemblyAiClient({
      apiKey: API_KEY,
      fetchImpl: f.impl,
      sleep,
      requestTimeoutMs: 5,
    });
    const err = await client.transcribe(Buffer.from('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssemblyAiError);
    expect((err as Error).message).toBe('assemblyai_request_timeout: upload after 3 attempts');
    expect((err as Error).cause).toMatchObject({ name: 'TimeoutError' });
    expect(f.mock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 3000]);
    const text = formatEngineError(err);
    expect(text).toMatch(
      /^assemblyai_request_timeout: upload after 3 attempts \(cause: TimeoutError: /,
    );
    expect(text).not.toContain(API_KEY);
  });

  it('rede esgotada: mensagem e cause úteis, sem a chave da API', async () => {
    const f = routedFetch({ upload: [fail(econnreset())] });
    const client = createAssemblyAiClient({
      apiKey: API_KEY,
      fetchImpl: f.impl,
      sleep: async () => undefined,
    });
    const err = await client.transcribe(Buffer.from('x')).catch((e: unknown) => e);
    expect((err as Error).message).toBe('assemblyai_network_error: upload after 3 attempts');
    const text = formatEngineError(err);
    expect(text).toBe(
      'assemblyai_network_error: upload after 3 attempts (cause: TypeError: fetch failed <- ECONNRESET: read ECONNRESET)',
    );
    expect(text).not.toContain(API_KEY);
    expect(String((err as Error).message)).not.toContain(API_KEY);
  });

  it('HTTP 4xx não é repetido', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = routedFetch({ upload: [async () => json({ error: 'bad' }, 401)] });
    const client = createAssemblyAiClient({ apiKey: API_KEY, fetchImpl: f.impl, sleep });
    await expect(client.transcribe(Buffer.from('x'))).rejects.toThrow('assemblyai_http_401');
    expect(f.mock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('HTTP 5xx também não é repetido aqui (fica para o drain)', async () => {
    const f = routedFetch({ upload: [async () => json({}, 503)] });
    const client = createAssemblyAiClient({
      apiKey: API_KEY,
      fetchImpl: f.impl,
      sleep: async () => undefined,
    });
    await expect(client.transcribe(Buffer.from('x'))).rejects.toThrow('assemblyai_http_503');
    expect(f.mock).toHaveBeenCalledTimes(1);
  });

  it('poll com falha de rede transitória continua o polling', async () => {
    const f = routedFetch({
      upload: [ok({ upload_url: 'https://cdn/u' })],
      create: [ok({ id: 't1', status: 'processing' })],
      poll: [fail(econnreset()), ok(COMPLETED)],
    });
    const client = createAssemblyAiClient({
      apiKey: API_KEY,
      fetchImpl: f.impl,
      sleep: async () => undefined,
    });
    await expect(client.transcribe(Buffer.from('x'))).resolves.toMatchObject({ text: 'olá' });
    expect(f.calls.filter((c) => c.url.endsWith('/transcript/t1'))).toHaveLength(2);
  });
});

describe('isRetryableNetworkError', () => {
  it('classifica erros de rede e recusa erros HTTP', () => {
    expect(isRetryableNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableNetworkError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
      true,
    );
    expect(isRetryableNetworkError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(
      true,
    );
    expect(isRetryableNetworkError(new Error('x', { cause: { code: 'UND_ERR_SOCKET' } }))).toBe(
      true,
    );
    expect(isRetryableNetworkError(new AssemblyAiError('assemblyai_http_500'))).toBe(false);
    expect(isRetryableNetworkError(new Error('boom'))).toBe(false);
    expect(isRetryableNetworkError(null)).toBe(false);
  });
});

describe('formatEngineError', () => {
  it('usa a mensagem do Error e fallback para não-Error', () => {
    expect(formatEngineError(new Error('assemblyai_http_500'))).toBe('assemblyai_http_500');
    expect(formatEngineError({ weird: true })).toBe('unknown_error');
    expect(formatEngineError(undefined, 'jev_unknown_error')).toBe('jev_unknown_error');
  });

  it('mantém prefixos de monitoramento no início', () => {
    const cause = Object.assign(new Error('x'), { code: 'E1' });
    expect(
      formatEngineError(new Error(`${DURATION_MISMATCH_PREFIX}: call=60s audio=20.0s`, { cause })),
    ).toMatch(/^duration_mismatch: call=60s audio=20\.0s \(cause: E1: x\)$/);
    expect(formatEngineError(new Error(`${DURATION_WARNING_PREFIX}: a`))).toMatch(
      /^duration_warning/,
    );
  });

  it('não grava stack, credenciais nem query string', () => {
    const err = new Error('falhou', {
      cause: new Error(
        'GET https://listener.example.com/rec.mp3?token=abc123 authorization: Bearer xyz\nlinha2',
      ),
    });
    const text = formatEngineError(err);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('xyz');
    expect(text).not.toContain('\n');
    expect(text).not.toMatch(/at .+:\d+:\d+/);
    expect(text.startsWith('falhou (cause: ')).toBe(true);
  });

  it('limita o tamanho', () => {
    expect(
      formatEngineError(new Error('a'.repeat(5000), { cause: new Error('b'.repeat(5000)) })).length,
    ).toBeLessThanOrEqual(600);
  });
});

import {
  ASSEMBLYAI_BASE_URL,
  ASSEMBLYAI_KEYTERMS_PROMPT,
  ASSEMBLYAI_LANGUAGE,
  ASSEMBLYAI_SPEECH_MODEL,
  ASSEMBLYAI_USD_PER_AUDIO_HOUR,
} from './constants';

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface AssemblyAiResult {
  text: string;
  utterances: Utterance[];
  speakersCount: number;
  audioSeconds: number;
  model: string;
}

export interface AssemblyAiClient {
  transcribe(audio: Buffer): Promise<AssemblyAiResult>;
}

interface TranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  text?: string | null;
  audio_duration?: number | null;
  speech_model_used?: string | null;
  utterances?: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    confidence?: number;
  }> | null;
}

/** Custo estimado sobre os segundos de áudio cobrados (mono). Estéreo custaria 2x. */
export function computeAssemblyAiCostUsd(billedAudioSeconds: number): number {
  return Number(((billedAudioSeconds / 3600) * ASSEMBLYAI_USD_PER_AUDIO_HOUR).toFixed(6));
}

export class AssemblyAiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AssemblyAiError';
  }
}

/** Timeout de cada requisição (upload, criação e cada poll). O prazo do job é `timeoutMs`. */
export const ASSEMBLYAI_REQUEST_TIMEOUT_MS = 30_000;

/** Esperas antes de cada nova tentativa: 2 retries, 3 tentativas no total. */
export const ASSEMBLYAI_RETRY_DELAYS_MS = [1000, 3000];

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * Falha de rede/timeout, sem resposta HTTP: TypeError('fetch failed') do undici, AbortError/TimeoutError
 * do AbortSignal.timeout e erros de sistema do Node (ECONNRESET, ETIMEDOUT...), inclusive no `cause`.
 * Respostas HTTP (4xx e 5xx) NÃO entram: viram AssemblyAiError e não são repetidas aqui, para manter
 * o cliente simples e não repetir erro que o provedor já decidiu. O retry de longo prazo é o drain.
 */
export function isRetryableNetworkError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur; depth++) {
    if (cur instanceof AssemblyAiError) return false;
    if (typeof cur !== 'object') return false;
    const e = cur as { name?: unknown; code?: unknown; cause?: unknown };
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (typeof e.code === 'string' && RETRYABLE_CODES.has(e.code)) return true;
    if (cur instanceof TypeError) return true;
    cur = e.cause;
  }
  return false;
}

interface Options {
  apiKey: string;
  pollIntervalMs?: number;
  /** Prazo total do job (polling). */
  timeoutMs?: number;
  /** Timeout de cada requisição HTTP. */
  requestTimeoutMs?: number;
  /** Esperas entre tentativas em falha de rede. Tamanho = número de retries. */
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  /** Usado no polling e no backoff (injetável nos testes). */
  sleep?: (ms: number) => Promise<void>;
}

export function createAssemblyAiClient(opts: Options): AssemblyAiClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? ASSEMBLYAI_REQUEST_TIMEOUT_MS;
  const retryDelays = opts.retryDelaysMs ?? ASSEMBLYAI_RETRY_DELAYS_MS;

  /**
   * Uma requisição com timeout próprio e retry curto só em falha de rede.
   * Obs.: retry do POST /transcript pode, no pior caso (resposta perdida após o servidor aceitar),
   * criar um job duplicado; o custo é pequeno perto de perder a transcrição inteira.
   * A mensagem de erro nunca inclui headers (a chave fica só no header authorization).
   */
  async function call<T>(step: string, url: string, init: RequestInit): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt > 0) await sleep(retryDelays[attempt - 1] ?? 0);
      let res: Response;
      try {
        res = await doFetch(url, {
          ...init,
          signal: AbortSignal.timeout(requestTimeoutMs),
          headers: {
            authorization: opts.apiKey,
            ...(init.headers as Record<string, string> | undefined),
          },
        });
      } catch (err) {
        lastErr = err;
        if (!isRetryableNetworkError(err)) break;
        continue;
      }
      if (!res.ok) throw new AssemblyAiError(`assemblyai_http_${res.status}`);
      try {
        return (await res.json()) as T;
      } catch (err) {
        // Corpo cortado no meio (conexão caiu ao ler) também é falha de rede.
        lastErr = err;
        if (!isRetryableNetworkError(err)) break;
      }
    }
    const isTimeout =
      typeof lastErr === 'object' &&
      lastErr !== null &&
      ['AbortError', 'TimeoutError'].includes(String((lastErr as { name?: unknown }).name));
    throw new AssemblyAiError(
      `assemblyai_${isTimeout ? 'request_timeout' : 'network_error'}: ${step} after ${retryDelays.length + 1} attempts`,
      { cause: lastErr },
    );
  }

  return {
    async transcribe(audio) {
      const upload = await call<{ upload_url: string }>('upload', `${ASSEMBLYAI_BASE_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(audio),
      });
      const created = await call<TranscriptResponse>(
        'create',
        `${ASSEMBLYAI_BASE_URL}/transcript`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_url: upload.upload_url,
            speech_models: [ASSEMBLYAI_SPEECH_MODEL],
            language_code: ASSEMBLYAI_LANGUAGE,
            speaker_labels: true,
            keyterms_prompt: ASSEMBLYAI_KEYTERMS_PROMPT,
          }),
        },
      );

      const deadline = Date.now() + timeoutMs;
      let current = created;
      while (current.status !== 'completed') {
        if (current.status === 'error')
          throw new AssemblyAiError(`assemblyai_error: ${current.error ?? 'unknown'}`);
        if (Date.now() > deadline) throw new AssemblyAiError('assemblyai_timeout');
        await sleep(pollMs);
        current = await call<TranscriptResponse>(
          'poll',
          `${ASSEMBLYAI_BASE_URL}/transcript/${created.id}`,
          { method: 'GET' },
        );
      }

      const utterances = (current.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
        ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
      }));
      return {
        text: current.text ?? '',
        utterances,
        speakersCount: new Set(utterances.map((u) => u.speaker)).size,
        audioSeconds: current.audio_duration ?? 0,
        model: current.speech_model_used ?? ASSEMBLYAI_SPEECH_MODEL,
      };
    },
  };
}

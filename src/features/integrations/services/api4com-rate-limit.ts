/**
 * Limitador do GET /calls da API4COM. O teto oficial é de 15 requisições por
 * minuto por token; o limitador fica em memória, um por token, e vale para o
 * processo (script ou instância da função). Janela deslizante: nunca mais de
 * `perMinute` reservas em 60s, e uma pausa pedida pelo servidor (429 com
 * `RateLimit-Reset` / `Retry-After`) segura todas as chamadas seguintes do token.
 */

/** Teto oficial da API4COM para GET /calls, por token. */
export const API4COM_CALLS_MAX_PER_MINUTE = 15;
export const API4COM_RATE_WINDOW_MS = 60_000;

export interface RateLimiterClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface CallsRateLimiter {
  /** Reserva uma vaga, esperando o necessário. false se a espera passaria de `maxWaitMs`. */
  acquire(maxWaitMs?: number): Promise<boolean>;
  /** Ninguém chama antes de `ms` a partir de agora (servidor pediu pausa). */
  pauseFor(ms: number): void;
}

/**
 * Espera pedida pelo servidor (`Retry-After` ou `RateLimit-Reset`), em ms.
 * Aceita segundos até o reset, data HTTP ou epoch em segundos.
 */
export function retryWaitMs(headers: Headers, now = Date.now()): number | null {
  for (const name of ['retry-after', 'ratelimit-reset', 'x-ratelimit-reset']) {
    const raw = headers.get(name);
    if (!raw) continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      // epoch em segundos (ex.: 1762862400) em vez de "segundos até o reset"
      if (seconds > 1e9) return Math.max(0, seconds * 1000 - now);
      return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return null;
}

const realClock: RateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Taxa válida: inteiro entre 1 e 15. Valor ausente ou inválido vira 15. */
export function clampCallsPerMinute(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return API4COM_CALLS_MAX_PER_MINUTE;
  return Math.min(Math.floor(n), API4COM_CALLS_MAX_PER_MINUTE);
}

export class SlidingWindowRateLimiter implements CallsRateLimiter {
  private stamps: number[] = [];
  private blockedUntil = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public perWindow: number,
    private readonly windowMs: number = API4COM_RATE_WINDOW_MS,
    private readonly clock: RateLimiterClock = realClock,
  ) {}

  acquire(maxWaitMs = Infinity): Promise<boolean> {
    // Fila: as reservas saem na ordem em que foram pedidas.
    const run = this.queue.then(() => this.reserve(maxWaitMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  pauseFor(ms: number): void {
    if (!(ms > 0)) return;
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + ms);
  }

  /** Quanto falta para a próxima vaga (0 = livre agora). */
  waitMs(): number {
    const now = this.clock.now();
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    let wait = Math.max(0, this.blockedUntil - now);
    if (this.stamps.length >= this.perWindow) {
      const oldest = this.stamps[this.stamps.length - this.perWindow]!;
      wait = Math.max(wait, oldest + this.windowMs - now);
    }
    return wait;
  }

  private async reserve(maxWaitMs: number): Promise<boolean> {
    let budget = maxWaitMs;
    for (;;) {
      const wait = this.waitMs();
      if (wait <= 0) {
        this.stamps.push(this.clock.now());
        return true;
      }
      if (wait > budget) return false;
      budget -= wait;
      await this.clock.sleep(wait);
    }
  }
}

let configuredPerMinute: number | null = null;
const limiters = new Map<string, SlidingWindowRateLimiter>();

/** Taxa em uso: a configurada, senão `API4COM_CALLS_PER_MINUTE`, senão 15 (nunca acima de 15). */
export function api4comCallsPerMinute(): number {
  return configuredPerMinute ?? clampCallsPerMinute(process.env.API4COM_CALLS_PER_MINUTE);
}

/** Muda a taxa (ex.: `--rate` do script). Vale também para limitadores já criados. */
export function setApi4ComCallsPerMinute(perMinute: number): number {
  configuredPerMinute = clampCallsPerMinute(perMinute);
  for (const limiter of limiters.values()) limiter.perWindow = configuredPerMinute;
  return configuredPerMinute;
}

/** Limitador compartilhado do token (um por token, como o teto da API4COM). */
export function getApi4ComCallsLimiter(apiKey: string): SlidingWindowRateLimiter {
  let limiter = limiters.get(apiKey);
  if (!limiter) {
    limiter = new SlidingWindowRateLimiter(api4comCallsPerMinute());
    limiters.set(apiKey, limiter);
  }
  return limiter;
}

/** Só para testes. */
export function resetApi4ComCallsLimiters(): void {
  limiters.clear();
  configuredPerMinute = null;
}

/**
 * GET /calls de uma página do reconcile, dentro do limite da API4COM.
 *
 * O teto oficial é 15 GET /calls por minuto por token. Antes de cada tentativa
 * reserva uma vaga no limitador do token (`getApi4ComCallsLimiter`, o mesmo do
 * reparo de gravações); em 429 lê `Retry-After` / `RateLimit-Reset`, pausa o
 * token pelo tempo pedido e tenta de novo. Sem cabeçalho, backoff com teto de
 * pouco mais de 1 min (a janela do limite). Nunca loga o token.
 */
import { type CallsRateLimiter, retryWaitMs } from './api4com-rate-limit';

/** Retentativas em 429 por página (além da primeira tentativa). */
export const RECONCILE_MAX_RATE_LIMIT_RETRIES = 3;
/** Espera inicial em 429 sem cabeçalho; dobra a cada tentativa. */
export const RECONCILE_RATE_LIMIT_FALLBACK_MS = 15_000;
/** Teto de uma espera: a janela do limite é 1 min, mais uma folga. */
export const RECONCILE_RATE_LIMIT_MAX_WAIT_MS = 65_000;
export const RECONCILE_REQUEST_TIMEOUT_MS = 30_000;

export interface ReconcileFetchDeps {
  fetchFn: typeof fetch;
  limiter: CallsRateLimiter;
  now?: () => number;
}

export type ReconcilePageResult =
  /** Resposta que não é 429 (ok ou outro erro HTTP): o chamador decide. */
  | { kind: 'response'; response: Response }
  /** 429 persistiu depois de todas as retentativas. */
  | { kind: 'rate_limited'; attempts: number }
  /** Erro de rede ou timeout. */
  | { kind: 'fetch_failed'; error: Error };

/** Espera após um 429: a pedida pelo servidor, senão backoff; sempre com teto. */
export function rateLimitWaitMs(headers: Headers, attempt: number, now = Date.now()): number {
  const requested = retryWaitMs(headers, now);
  const wait = requested ?? RECONCILE_RATE_LIMIT_FALLBACK_MS * 2 ** attempt;
  return Math.min(wait, RECONCILE_RATE_LIMIT_MAX_WAIT_MS);
}

export async function fetchReconcileCallsPage(
  deps: ReconcileFetchDeps,
  url: string,
  apiKey: string,
): Promise<ReconcilePageResult> {
  const now = deps.now ?? Date.now;
  for (let attempt = 0; attempt <= RECONCILE_MAX_RATE_LIMIT_RETRIES; attempt++) {
    await deps.limiter.acquire();

    let response: Response;
    try {
      response = await deps.fetchFn(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
        signal: AbortSignal.timeout(RECONCILE_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return { kind: 'fetch_failed', error: err instanceof Error ? err : new Error(String(err)) };
    }

    if (response.status !== 429) return { kind: 'response', response };
    if (attempt === RECONCILE_MAX_RATE_LIMIT_RETRIES) {
      return { kind: 'rate_limited', attempts: attempt + 1 };
    }
    // A pausa vale para todas as chamadas do token; o próximo acquire espera.
    deps.limiter.pauseFor(rateLimitWaitMs(response.headers, attempt, now()));
  }
  return { kind: 'rate_limited', attempts: RECONCILE_MAX_RATE_LIMIT_RETRIES + 1 };
}

/**
 * Retry com backoff para chamadas ao CRM que falham por REDE (não por resposta
 * da API). Caso real 26–27/10/2026: o host do Coolify ficou sem DNS
 * (`getaddrinfo EAI_AGAIN` no domínio do Kommo) no instante em que 4 closers
 * responderam "Realizada" — o push falhou uma vez e nada tentava de novo.
 *
 * Regra: só repete quando o erro é de transporte (DNS, conexão recusada/
 * resetada, timeout, `fetch failed` do undici). Resposta 4xx/5xx do CRM
 * (`Kommo API error (400): ...`) NÃO repete — o erro é da chamada, não da rede.
 */

/** Esperas entre tentativas: 3 repetições (2s, 8s, 30s) depois da primeira. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];

export interface RetryPolicy {
  /** Espera antes de cada nova tentativa; o tamanho da lista é o nº de repetições. */
  delaysMs: readonly number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { delaysMs: DEFAULT_RETRY_DELAYS_MS };

/** Sem repetição: uma tentativa só. Para caminhos síncronos (clique do SDR). */
export const NO_RETRY: RetryPolicy = { delaysMs: [] };

/** Códigos de erro de socket/DNS do Node (ficam em `err.cause.code` no undici). */
const NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const NETWORK_MESSAGE_RE =
  /fetch failed|EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed out|socket hang up/i;

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
}

/**
 * Erro de transporte (vale a pena tentar de novo)? Cobre o `fetch failed` do
 * undici com `cause.code` (EAI_AGAIN etc.), `AbortSignal.timeout` (TimeoutError /
 * AbortError), `withTimeout` ("timed out after") e mensagens que embrulham o
 * erro original (`Kommo fetch to ... failed: fetch failed`).
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const code = errorCode(err);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  if (NETWORK_MESSAGE_RE.test(err.message)) return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && cause !== err && isNetworkError(cause);
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = errorCode(err);
  return code ? `${err.message} [${code}]` : err.message;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn`; em erro de rede espera `delaysMs[i]` e tenta de novo, até
 * esgotar a lista. Qualquer outro erro (ou a última falha de rede) é relançado
 * como veio, para o chamador decidir. Loga cada repetição com o `label`.
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  label: string,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  const delays = policy.delaysMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !isNetworkError(err)) throw err;
      console.warn(
        `[crm-push] ${label}: erro de rede (${describeError(err)}); nova tentativa ${attempt + 1}/${delays.length} em ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}

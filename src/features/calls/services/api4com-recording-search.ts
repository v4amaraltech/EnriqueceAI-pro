/**
 * Busca de gravação na API4COM, somente leitura (só GET).
 * Parte pura + cliente HTTP injetável, para testar sem rede e sem esperar o backoff.
 *
 * Ordem (o chamador para no primeiro candidato cuja duração bate):
 *  a) por id (`api4com_call_id` e `alt_api4com_ids`) com `filter={"where":{"id":...}}`;
 *  b) por janela de data em torno do início da ligação, paginando só dentro dela.
 */
import {
  parseApi4ComTimestamp,
  toApi4ComFilterTimestamp,
} from '@/features/integrations/services/api4com-time';
import type {
  Api4ComCallListResponse,
  Api4ComCallRecord,
} from '@/features/integrations/types/api4com';

/** Meia janela em torno do início da ligação. */
export const SEARCH_WINDOW_MINUTES = 20;
export const SEARCH_PAGE_LIMIT = 100;
/** Teto de páginas dentro da janela (100 ligações por página). */
export const SEARCH_MAX_WINDOW_PAGES = 5;
/** Teto de requisições (sem contar retentativas) por ligação. */
export const SEARCH_MAX_REQUESTS = 12;
export const BACKOFF_MAX_ATTEMPTS = 4;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_WAIT_MS = 30_000;

export interface SearchDeps {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  apiKey: string;
  baseUrl: string;
}

export interface SearchCall {
  destination: string;
  origin: string | null;
  started_at: string | null;
  created_at: string;
  duration_seconds: number;
  metadata: Record<string, unknown> | null;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function buildCallsUrl(
  baseUrl: string,
  where: Record<string, unknown>,
  page: number,
): string {
  const filter = encodeURIComponent(JSON.stringify({ where }));
  return `${baseUrl}/calls?page=${page}&limit=${SEARCH_PAGE_LIMIT}&filter=${filter}`;
}

/** Espera pedida pelo servidor (`Retry-After` ou `RateLimit-Reset`, em segundos ou data), em ms. */
export function retryWaitMs(headers: Headers, now = Date.now()): number | null {
  for (const name of ['retry-after', 'ratelimit-reset']) {
    const raw = headers.get(name);
    if (!raw) continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return null;
}

/** GET com retentativa em 429/503: respeita o cabeçalho, senão backoff exponencial (1s, 2s, 4s). */
export async function getWithBackoff(deps: SearchDeps, url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < BACKOFF_MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await deps.fetchFn(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: deps.apiKey },
      });
    } catch {
      return null;
    }
    if (response.status !== 429 && response.status !== 503) return response.ok ? response : null;
    if (attempt === BACKOFF_MAX_ATTEMPTS - 1) return null;
    const wait = retryWaitMs(response.headers) ?? BACKOFF_BASE_MS * 2 ** attempt;
    await deps.sleep(Math.min(wait, BACKOFF_MAX_WAIT_MS));
  }
  return null;
}

/** Heurística de telefone + horário + duração (a mesma do fetchCallRecording). */
export function matchesCallHeuristic(record: Api4ComCallRecord, call: SearchCall): boolean {
  const destKey = call.destination.replace(/\D/g, '').slice(-8);
  const originKey = (call.origin ?? '').replace(/\D/g, '').slice(-4);
  const localTime = new Date(call.started_at ?? call.created_at).getTime();

  const phoneKey = (record.to ?? '').replace(/\D/g, '').slice(-8);
  const fromKey = (record.from ?? '').replace(/\D/g, '').slice(-8);
  const phoneMatch = phoneKey === destKey || (originKey.length >= 3 && fromKey.endsWith(originKey));
  if (!phoneMatch) return false;

  const remoteDate = parseApi4ComTimestamp(record.started_at);
  const timeDiff = Math.abs((remoteDate ? remoteDate.getTime() : NaN) - localTime);
  const durationMatch =
    record.duration > 0 && call.duration_seconds > 0
      ? Math.abs(record.duration - call.duration_seconds) /
          Math.max(record.duration, call.duration_seconds) <
        0.3
      : true;
  return timeDiff < 10 * 60 * 1000 && durationMatch;
}

/** Ids do provedor guardados na ligação, sem repetição. */
export function providerIds(metadata: Record<string, unknown> | null): string[] {
  const ids: string[] = [];
  const main = metadata?.api4com_call_id;
  if (typeof main === 'string' && main) ids.push(main);
  const alt = metadata?.alt_api4com_ids;
  if (Array.isArray(alt))
    for (const id of alt) if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  return ids;
}

async function readPage(deps: SearchDeps, url: string): Promise<Api4ComCallListResponse | null> {
  const response = await getWithBackoff(deps, url);
  if (!response) return null;
  try {
    return (await response.json()) as Api4ComCallListResponse;
  } catch {
    return null;
  }
}

/**
 * Gera, em ordem, os `record_url` candidatos. Nunca repete URL e respeita
 * `SEARCH_MAX_REQUESTS`: uma ligação não varre o histórico da conta.
 */
export async function* searchRecordingCandidates(
  deps: SearchDeps,
  call: SearchCall,
): AsyncGenerator<string> {
  const seen = new Set<string>();
  let requests = 0;

  // a) busca pontual por id
  for (const id of providerIds(call.metadata)) {
    if (requests >= SEARCH_MAX_REQUESTS) return;
    requests++;
    const page = await readPage(deps, buildCallsUrl(deps.baseUrl, { id }, 1));
    for (const record of page?.data ?? []) {
      if (record.id === id && record.record_url && !seen.has(record.record_url)) {
        seen.add(record.record_url);
        yield record.record_url;
      }
    }
  }

  // b) janela de data em torno do início da ligação
  const center = new Date(call.started_at ?? call.created_at).getTime();
  if (Number.isNaN(center)) return;
  const halfWindow = SEARCH_WINDOW_MINUTES * 60 * 1000;
  const where = {
    started_at: {
      gte: toApi4ComFilterTimestamp(new Date(center - halfWindow)),
      lte: toApi4ComFilterTimestamp(new Date(center + halfWindow)),
    },
  };
  for (let pageNumber = 1, pages = 0; pages < SEARCH_MAX_WINDOW_PAGES; pageNumber++, pages++) {
    if (requests >= SEARCH_MAX_REQUESTS) return;
    requests++;
    const page = await readPage(deps, buildCallsUrl(deps.baseUrl, where, pageNumber));
    if (!page) return;
    for (const record of page.data ?? []) {
      if (record.record_url && !seen.has(record.record_url) && matchesCallHeuristic(record, call)) {
        seen.add(record.record_url);
        yield record.record_url;
      }
    }
    const next = page.metadata?.nextPage;
    if (!next) return;
    pageNumber = next - 1;
  }
}

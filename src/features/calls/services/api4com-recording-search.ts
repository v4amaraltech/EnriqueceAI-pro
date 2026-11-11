/**
 * Busca de gravação na API4COM, somente leitura (só GET).
 * Parte pura + cliente HTTP injetável, para testar sem rede e sem esperar o backoff.
 *
 * Ordem (o chamador para no primeiro candidato cuja duração bate):
 *  a) por id (`api4com_call_id` e `alt_api4com_ids`) com `filter={"where":{"id":...}}`;
 *  b) por janela de data em torno do início da ligação, paginando só dentro dela.
 *     Na janela, o ramal sozinho não basta: precisa do fone de destino ou de um
 *     candidato único (ver `selectWindowCandidates`).
 */
import {
  parseApi4ComTimestamp,
  toApi4ComFilterTimestamp,
} from '@/features/integrations/services/api4com-time';
import type {
  Api4ComCallListResponse,
  Api4ComCallRecord,
} from '@/features/integrations/types/api4com';
import { brPhoneVariants } from '@/features/lead-messages/phone-match';

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

/** Candidato a gravação, ou aviso de janela ambígua (vários do ramal, nenhum do destino). */
export type RecordingSearchEvent =
  | {
      kind: 'candidate';
      url: string;
      phase: 'id' | 'window';
      /** provider_id: busca pelo id da própria ligação; destination: fone de destino bate;
       *  unique_in_window: único candidato do ramal na janela, sem fone que contradiga. */
      match: 'provider_id' | 'destination' | 'unique_in_window';
    }
  | { kind: 'ambiguous_window'; candidates: number };

/** Formas comparáveis de um telefone: variantes BR (com/sem DDI e nono dígito) ou os dígitos. */
function phoneForms(raw: string | null | undefined): string[] {
  const digits = String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
  if (digits.length < 8) return [];
  const variants = brPhoneVariants(digits);
  return variants.length > 0 ? variants : [digits];
}

/**
 * Mesmo telefone depois de normalizar (DDI 55, zero à esquerda, nono dígito).
 * Sem DDD de um dos lados, compara os 8 últimos dígitos. `null` quando algum
 * lado não tem telefone comparável (ramal, vazio).
 */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean | null {
  const left = phoneForms(a);
  const right = phoneForms(b);
  if (left.length === 0 || right.length === 0) return null;
  if (left.some((form) => right.includes(form))) return true;
  const tail = (forms: string[]) => forms.map((f) => f.slice(-8));
  const rightTails = tail(right);
  return tail(left).some((t) => rightTails.includes(t));
}

/** O registro é da ligação pelo destino (para quem ligou, ou de quem recebeu)? */
function destinationMatch(record: Api4ComCallRecord, call: SearchCall): boolean | null {
  const to = samePhone(record.to, call.destination);
  if (to === true) return true;
  if (samePhone(record.from, call.destination) === true) return true;
  return to;
}

/**
 * Decide, entre os registros da janela que passam na heurística (ramal ou fone,
 * horário e duração), quais `record_url` podem ser desta ligação:
 * - algum registro com o fone de destino batendo: só esses (ramal sozinho não basta);
 * - nenhum com o destino: aceita só se houver UM candidato e o fone dele não contradiz;
 * - vários candidatos só pelo ramal (ou um com fone de outro número): ambíguo, nada.
 * Registros com o id da própria ligação não contam como concorrentes.
 */
export function selectWindowCandidates(
  records: Api4ComCallRecord[],
  call: SearchCall,
): RecordingSearchEvent[] {
  const ownIds = new Set(providerIds(call.metadata));
  const consistent = new Map<string, Api4ComCallRecord>();
  for (const record of records) {
    if (ownIds.has(record.id) || !matchesCallHeuristic(record, call)) continue;
    consistent.set(record.id || record.record_url || String(consistent.size), record);
  }
  const all = [...consistent.values()];
  if (all.length === 0) return [];

  const center = new Date(call.started_at ?? call.created_at).getTime();
  const distance = (r: Api4ComCallRecord) =>
    Math.abs((parseApi4ComTimestamp(r.started_at)?.getTime() ?? Infinity) - center);

  const byDestination = all.filter((r) => destinationMatch(r, call) === true);
  if (byDestination.length > 0) {
    return byDestination
      .filter((r) => r.record_url)
      .sort((a, b) => distance(a) - distance(b))
      .map((r) => ({
        kind: 'candidate',
        url: r.record_url!,
        phase: 'window',
        match: 'destination',
      }));
  }

  const only = all.length === 1 ? all[0] : undefined;
  if (only?.record_url && destinationMatch(only, call) === null) {
    return [
      { kind: 'candidate', url: only.record_url, phase: 'window', match: 'unique_in_window' },
    ];
  }
  return [{ kind: 'ambiguous_window', candidates: all.length }];
}

/**
 * Gera, em ordem, os candidatos: primeiro pelo id do provedor, depois os da janela
 * (ver `selectWindowCandidates`). Nunca repete URL e respeita `SEARCH_MAX_REQUESTS`:
 * uma ligação não varre o histórico da conta. A janela inteira é lida antes de
 * decidir, para saber se o candidato é único.
 */
export async function* searchRecordingCandidates(
  deps: SearchDeps,
  call: SearchCall,
): AsyncGenerator<RecordingSearchEvent> {
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
        yield { kind: 'candidate', url: record.record_url, phase: 'id', match: 'provider_id' };
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
  const records: Api4ComCallRecord[] = [];
  for (let pageNumber = 1, pages = 0; pages < SEARCH_MAX_WINDOW_PAGES; pageNumber++, pages++) {
    if (requests >= SEARCH_MAX_REQUESTS) break;
    requests++;
    const page = await readPage(deps, buildCallsUrl(deps.baseUrl, where, pageNumber));
    if (!page) break;
    records.push(...(page.data ?? []));
    const next = page.metadata?.nextPage;
    if (!next) break;
    pageNumber = next - 1;
  }
  for (const event of selectWindowCandidates(records, call)) {
    if (event.kind === 'candidate') {
      if (seen.has(event.url)) continue;
      seen.add(event.url);
    }
    yield event;
  }
}

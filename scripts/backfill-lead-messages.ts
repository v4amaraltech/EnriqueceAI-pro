/**
 * Copia interactions de WhatsApp e e-mail de UMA org para lead_messages.
 *
 * Não roda no CI e não grava sem --execute. O padrão é --dry-run:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/backfill-lead-messages.ts --org <uuid>
 *
 *   pnpm exec tsx scripts/backfill-lead-messages.ts --org <uuid> --execute
 *   pnpm exec tsx scripts/backfill-lead-messages.ts --org <uuid> --execute \
 *     --from-cursor <created_at>,<id>
 *
 * A leitura filtra org_id. Outra organização não entra na consulta.
 * A página usa (created_at, id), então o mesmo instante na borda não some.
 * --from-cursor continua depois dessa linha. O log de falha imprime o
 * mesmo par para a próxima execução.
 * O upsert usa (org_id, provider, provider_message_id) em lotes.
 * O status usa (message_id, status), também em lote. Rodar de novo não duplica.
 * provider fica 'legacy_interactions'. Não baixa mídia e não apaga interactions.
 * Erro de rede tenta de novo até 5 vezes. Constraint e validação não repetem.
 */
import { pathToFileURL } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { LegacyInteraction, LegacyLeadMessage } from '../src/features/lead-messages/backfill';
import {
  audienceFromDirectory,
  cursorAfter,
  decideLegacyCopy,
  formatSample,
  keysetFilter,
  parseBackfillArgs,
  type BackfillCursor,
  type LeadAudience,
} from '../src/features/lead-messages/backfill-script';

const PAGE = 200;
let clientSeq = 0;
/** Entre 100 e 500 linhas por POST. A página já cabe num lote. */
export const MESSAGE_BATCH = 200;
export const STATUS_BATCH = 200;
/** Primeira tentativa mais quatro repetições. */
export const MAX_ATTEMPTS = 5;
const SAMPLE_LIMIT = 5;
const CHANNELS = ['whatsapp', 'email'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSIENT_CODE = /^(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE)$/;

interface ChannelTally {
  wouldCopy: number;
  copied: number;
  duplicates: number;
  reasons: Record<string, number>;
}

interface PgError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface QueryResult {
  data: unknown;
  error: PgError | null;
  status?: number;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface PendingCopy {
  channel: 'whatsapp' | 'email';
  insert: Omit<LegacyLeadMessage, 'status'>;
  status: LegacyLeadMessage['status'];
}

interface RunBackfillOptions {
  argv: string[];
  url?: string;
  key?: string;
  fetch?: FetchLike;
  log?: (line: string) => void;
  /** 0 a 1. Teste usa 0 para a espera ficar estável. */
  random?: () => number;
  messageBatch?: number;
  statusBatch?: number;
}

class BackfillFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillFailure';
  }
}

function emptyTally(): ChannelTally {
  return { wouldCopy: 0, copied: 0, duplicates: 0, reasons: {} };
}

function addReason(tally: ChannelTally, reason: string) {
  tally.reasons[reason] = (tally.reasons[reason] ?? 0) + 1;
}

function skippedTotal(tally: ChannelTally): number {
  return Object.values(tally.reasons).reduce((sum, count) => sum + count, 0);
}

function printReport(
  log: (line: string) => void,
  execute: boolean,
  tallies: Record<string, ChannelTally>,
  samples: string[],
) {
  const mode = execute ? 'execute' : 'dry-run';
  log(`Modo: ${mode}. Nenhuma outra org foi consultada.`);
  for (const channel of CHANNELS) {
    const tally = tallies[channel] ?? emptyTally();
    if (execute) {
      log(`${channel}  copiadas: ${tally.copied}  duplicadas: ${tally.duplicates}  ignoradas: ${skippedTotal(tally)}`);
    } else {
      log(`${channel}  copiaria: ${tally.wouldCopy}  ignoradas: ${skippedTotal(tally)}`);
    }
    for (const reason of Object.keys(tally.reasons).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      log(`  ${reason}: ${tally.reasons[reason]}`);
    }
  }
  if (!execute) {
    log(samples.length === 0 ? 'Amostras: nenhuma linha seria copiada.' : 'Amostras (corpo até 60, endereço mascarado):');
    for (const sample of samples) log(`  ${sample}`);
    log('Dry-run: nenhuma escrita.');
  }
}

/** Espera da tentativa `failedAttempt` (1 = primeira falha): 250ms, 500ms, 1s, 2s, teto 8s, mais até 25% de jitter. */
export function retryDelayMs(failedAttempt: number, random: () => number): number {
  const exponential = Math.min(8_000, 250 * 2 ** Math.max(0, failedAttempt - 1));
  const jitter = Math.floor(random() * exponential * 0.25);
  return exponential + jitter;
}

function textOf(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message}`;
  if (!value || typeof value !== 'object') return String(value ?? '');
  const rec = value as Record<string, unknown>;
  return [rec.code, rec.message, rec.details, rec.hint, rec.name].filter((part) => typeof part === 'string').join(' ');
}

function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function errorCode(value: unknown): string {
  if (!value || typeof value !== 'object' || !('code' in value)) return '';
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

/** Constraint, validação e PGRST não são instabilidade de rede. */
export function isHardPostgrestError(error: unknown): boolean {
  for (const node of causeChain(error)) {
    const code = errorCode(node);
    if (/^(22|23)\d{3}$/.test(code) || code.startsWith('PGRST')) return true;
  }
  return false;
}

/** fetch failed, ECONNRESET, ETIMEDOUT, UND_ERR_* e HTTP 429 ou 5xx. 4xx (exceto 429) não repete. */
export function shouldRetry(status: number | undefined, error: unknown): boolean {
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status !== undefined && status >= 400 && status < 500) return false;
  if (isHardPostgrestError(error)) return false;
  const blob = causeChain(error).map(textOf).join('\n');
  if (/fetch failed/i.test(blob)) return true;
  if (/UND_ERR_/.test(blob)) return true;
  if (/(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE)/.test(blob)) return true;
  return causeChain(error).some((node) => {
    const code = errorCode(node);
    return code.startsWith('UND_ERR_') || TRANSIENT_CODE.test(code);
  });
}

function linesFor(node: unknown): string[] {
  if (node instanceof Error) {
    const code = errorCode(node);
    return [code ? `${node.name}: ${node.message} (${code})` : `${node.name}: ${node.message}`];
  }
  if (!node || typeof node !== 'object') return [String(node ?? '')];
  const rec = node as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const lines: string[] = [];
  const code = typeof rec.code === 'string' ? rec.code : '';
  const message = typeof rec.message === 'string' ? rec.message : '';
  if (code || message) lines.push(`Causa: ${[code, message].filter(Boolean).join(' ')}`);
  if (typeof rec.details === 'string' && rec.details) lines.push(rec.details);
  if (typeof rec.hint === 'string' && rec.hint) lines.push(rec.hint);
  return lines;
}

/** Texto da falha final, com a causa (code e message) e o cursor para --from-cursor. */
export function formatFailure(error: unknown, cursor: BackfillCursor | null): string {
  const lines = ['Falha definitiva. O script parou.'];
  if (cursor) {
    lines.push(`Cursor: ${cursor.createdAt},${cursor.id}`);
    lines.push(`Retomar com: --from-cursor ${cursor.createdAt},${cursor.id}`);
  } else {
    lines.push('Cursor: (início). Rode de novo sem --from-cursor.');
  }
  const described = causeChain(error).flatMap(linesFor).filter((line) => line.length > 0);
  lines.push(described.length > 0 ? described.join('\n') : 'Erro sem detalhe.');
  return lines.join('\n');
}

export function parseFromCursor(raw: string): BackfillCursor {
  const comma = raw.indexOf(',');
  const createdAt = (comma === -1 ? '' : raw.slice(0, comma)).trim();
  const id = (comma === -1 ? '' : raw.slice(comma + 1)).trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !UUID.test(id)) {
    throw new Error('--from-cursor espera <created_at>,<id>, com data ISO e uuid.');
  }
  return { createdAt, id };
}

/** Tira --from-cursor do argv. O restante segue para o parser de --org e --execute. */
export function parseScriptArgs(argv: string[]): { argv: string[]; cursor: BackfillCursor | null } {
  const rest: string[] = [];
  let raw: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--from-cursor') {
      raw = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--from-cursor=')) {
      raw = arg.slice('--from-cursor='.length);
      continue;
    }
    rest.push(arg);
  }
  return { argv: rest, cursor: raw === null ? null : parseFromCursor(raw) };
}

export function chunks<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('Lote inválido.');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function insertedIds(data: unknown): Map<string, string> {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  const ids = new Map<string, string>();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const providerMessageId = (row as { provider_message_id?: unknown }).provider_message_id;
    if (typeof id === 'string' && typeof providerMessageId === 'string') ids.set(providerMessageId, id);
  }
  return ids;
}

function attachCause(error: PgError, transport: unknown): Error {
  const message = error.message ?? 'erro do PostgREST';
  const pg = {
    code: error.code ?? '',
    message,
    details: error.details ?? '',
    hint: error.hint ?? '',
    cause: transport instanceof Error ? (transport.cause ?? transport) : undefined,
  };
  return new Error(message, { cause: pg });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop(error: unknown, cursor: BackfillCursor | null): never {
  throw new BackfillFailure(formatFailure(error, cursor));
}

async function request<T>(
  run: () => PromiseLike<QueryResult>,
  cursor: BackfillCursor | null,
  bag: { transport: unknown },
  random: () => number,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    bag.transport = null;
    try {
      const result = await run();
      if (!result.error) return result.data as T;
      last = attachCause(result.error, bag.transport);
      const status = result.status ?? 0;
      if (!shouldRetry(status, last) || attempt === MAX_ATTEMPTS) stop(last, cursor);
    } catch (err) {
      if (err instanceof BackfillFailure) throw err;
      last = bag.transport ?? err;
      if (!shouldRetry(0, last) || attempt === MAX_ATTEMPTS) stop(last, cursor);
    }
    await sleep(retryDelayMs(attempt, random));
  }
  stop(last ?? new Error('falha sem detalhe'), cursor);
}

async function loadAudience(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  cache: Map<string, LeadAudience>,
  cursor: BackfillCursor | null,
  bag: { transport: unknown },
  random: () => number,
): Promise<LeadAudience> {
  const cached = cache.get(leadId);
  if (cached) return cached;
  const lead = await request<{ telefone?: unknown; phones?: unknown; email?: unknown; emails?: unknown } | null>(
    () => db.from('leads').select('telefone, phones, email, emails').eq('id', leadId).eq('org_id', orgId).maybeSingle(),
    cursor,
    bag,
    random,
  );
  const contacts = await request<Array<{ phones?: unknown; emails?: unknown }> | null>(
    () => db.from('lead_contacts').select('phones, emails').eq('lead_id', leadId).eq('org_id', orgId),
    cursor,
    bag,
    random,
  );
  const audience = audienceFromDirectory({
    telefone: lead?.telefone,
    phones: lead?.phones,
    email: lead?.email,
    emails: lead?.emails,
    contacts: contacts ?? [],
  });
  cache.set(leadId, audience);
  return audience;
}

async function flushCopies(
  db: SupabaseClient,
  pending: PendingCopy[],
  tallies: Record<string, ChannelTally>,
  cursor: BackfillCursor | null,
  bag: { transport: unknown },
  random: () => number,
  messageBatch: number,
  statusBatch: number,
) {
  for (const group of chunks(pending, messageBatch)) {
    const saved = await request<unknown>(
      () => db
        .from('lead_messages')
        .upsert(group.map((item) => item.insert), {
          onConflict: 'org_id,provider,provider_message_id',
          ignoreDuplicates: true,
        })
        .select('id, provider_message_id'),
      cursor,
      bag,
      random,
    );
    const ids = insertedIds(saved);
    const events: Array<{ org_id: string; message_id: string; status: string; occurred_at: string; raw: { source: string } }> = [];
    for (const item of group) {
      const tally = tallies[item.channel] ?? emptyTally();
      tallies[item.channel] = tally;
      const id = ids.get(item.insert.provider_message_id);
      if (!id) {
        tally.duplicates += 1;
        continue;
      }
      tally.copied += 1;
      if (!item.status) continue;
      events.push({
        org_id: item.insert.org_id,
        message_id: id,
        status: item.status,
        occurred_at: item.insert.occurred_at,
        raw: { source: 'legacy_interactions' },
      });
    }
    for (const eventGroup of chunks(events, statusBatch)) {
      await request(
        () => db.from('lead_message_status_events').upsert(eventGroup, {
          onConflict: 'message_id,status',
          ignoreDuplicates: true,
        }),
        cursor,
        bag,
        random,
      );
    }
  }
}

export async function runBackfill(options: RunBackfillOptions): Promise<void> {
  const parsed = parseScriptArgs(options.argv);
  const args = parseBackfillArgs(parsed.argv);
  const url = options.url;
  const key = options.key;
  if (!url || !key) {
    throw new Error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
  const log = options.log ?? console.log;
  const random = options.random ?? Math.random;
  const messageBatch = options.messageBatch ?? MESSAGE_BATCH;
  const statusBatch = options.statusBatch ?? STATUS_BATCH;
  const bag = { transport: null as unknown };
  const fetchImpl = options.fetch ?? fetch;
  const storageKey = `backfill-lead-messages-${++clientSeq}`;
  const observed: FetchLike = async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (err) {
      bag.transport = err;
      throw err;
    }
  };
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey },
    global: { fetch: observed },
  });
  const tallies: Record<string, ChannelTally> = { whatsapp: emptyTally(), email: emptyTally() };
  const samples: string[] = [];
  const audiences = new Map<string, LeadAudience>();
  let cursor: BackfillCursor | null = parsed.cursor;

  try {
    for (;;) {
      const pageCursor = cursor;
      const data = await request<LegacyInteraction[] | null>(
        () => {
          let query = db
            .from('interactions')
            .select('id, org_id, lead_id, channel, type, message_content, external_id, metadata, ai_generated, performed_by, created_at')
            .eq('org_id', args.orgId)
            .in('channel', ['whatsapp', 'email'])
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(PAGE);
          if (pageCursor) query = query.or(keysetFilter(pageCursor));
          return query;
        },
        pageCursor,
        bag,
        random,
      );
      const rows = data ?? [];
      if (rows.length === 0) break;

      const pending: PendingCopy[] = [];
      for (const row of rows) {
        if (row.org_id !== args.orgId) {
          throw new Error('A página trouxe outra org. O script parou sem gravar o restante.');
        }
        const channel = row.channel === 'email' ? 'email' : 'whatsapp';
        const tally = tallies[channel] ?? emptyTally();
        tallies[channel] = tally;
        const audience = await loadAudience(db, args.orgId, row.lead_id, audiences, pageCursor, bag, random);
        const decision = decideLegacyCopy(row, audience);
        if ('skip' in decision) {
          addReason(tally, decision.skip);
          continue;
        }
        if (!args.execute) {
          tally.wouldCopy += 1;
          if (samples.length < SAMPLE_LIMIT) samples.push(formatSample(row, decision.copy));
          continue;
        }
        const { status, ...insert } = decision.copy;
        pending.push({ channel, insert, status });
      }

      if (args.execute && pending.length > 0) {
        await flushCopies(db, pending, tallies, pageCursor, bag, random, messageBatch, statusBatch);
      }

      cursor = cursorAfter(rows);
      if (rows.length < PAGE) break;
    }
    printReport(log, args.execute, tallies, samples);
  } catch (err) {
    printReport(log, args.execute, tallies, samples);
    if (err instanceof BackfillFailure) throw err;
    throw new BackfillFailure(formatFailure(err, cursor));
  }
}

async function main() {
  try {
    await runBackfill({
      argv: process.argv.slice(2),
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  void main();
}

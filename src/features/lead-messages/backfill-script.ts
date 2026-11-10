import { isInternalChannelLog, isLeadConversation, listedAddresses, type ConversationCheck } from './audience';
import { legacyInteractionToMessage, type LegacyInteraction, type LegacyLeadMessage } from './backfill';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_PHONE_REASONS = new Set(['no_phone', 'no_lead_phone', 'no_phone_or_whatsapp']);

export interface BackfillCursor {
  createdAt: string;
  id: string;
}

export interface BackfillArgs {
  orgId: string;
  execute: boolean;
}

export interface LeadDirectory {
  telefone?: unknown;
  phones?: unknown;
  email?: unknown;
  emails?: unknown;
  contacts?: Array<{ phones?: unknown; emails?: unknown }>;
}

export type LeadAudience = Pick<ConversationCheck, 'leadPhones' | 'leadEmails' | 'phonesKnown' | 'emailsKnown'>;

export type SkipReason =
  | 'aviso interno'
  | 'sem telefone do lead'
  | 'sem e-mail do lead'
  | 'destino não é do lead'
  | 'vazio'
  | 'reunião'
  | 'tipo fora da conversa'
  | 'outro canal';

export type CopyDecision =
  | { copy: LegacyLeadMessage }
  | { skip: SkipReason };

/** --org é obrigatório. Sem --execute o padrão é ler e não gravar. */
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  let orgId = '';
  let execute = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--org') {
      orgId = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--org=')) {
      orgId = arg.slice('--org='.length);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (execute && dryRun) throw new Error('Use só um modo: --dry-run ou --execute.');
  if (!UUID.test(orgId)) {
    throw new Error('Informe --org com o uuid da organização. Sem isso o script não lê nada.');
  }
  return { orgId, execute };
}

/**
 * Página seguinte de (created_at, id). Não usa só created_at: linhas com o
 * mesmo instante da borda da página anterior continuam na próxima.
 */
export function matchesKeyset(
  row: { created_at: string; id: string },
  cursor: BackfillCursor | null,
): boolean {
  if (!cursor) return true;
  if (row.created_at > cursor.createdAt) return true;
  if (row.created_at < cursor.createdAt) return false;
  return row.id > cursor.id;
}

export function pageForOrg<T extends { org_id: string; created_at: string; id: string }>(
  rows: T[],
  orgId: string,
  cursor: BackfillCursor | null,
  pageSize: number,
): T[] {
  return rows
    .filter((row) => row.org_id === orgId && matchesKeyset(row, cursor))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(0, pageSize);
}

export function cursorAfter<T extends { created_at: string; id: string }>(page: T[]): BackfillCursor | null {
  const last = page[page.length - 1];
  if (!last) return null;
  return { createdAt: last.created_at, id: last.id };
}

/** Lê a org inteira, página a página, sem repetir e sem pular o mesmo created_at. */
export function readOrgPages<T extends { org_id: string; created_at: string; id: string }>(
  rows: T[],
  orgId: string,
  pageSize: number,
): T[] {
  const seen: T[] = [];
  let cursor: BackfillCursor | null = null;
  for (;;) {
    const page: T[] = pageForOrg(rows, orgId, cursor, pageSize);
    if (page.length === 0) break;
    seen.push(...page);
    cursor = cursorAfter(page);
    if (page.length < pageSize) break;
  }
  return seen;
}

function quoteFilter(value: string): string {
  return `"${value.replace(/[",()\\]/g, '')}"`;
}

/** Filtro PostgREST: created_at maior, ou igual com id maior. */
export function keysetFilter(cursor: BackfillCursor): string {
  const at = quoteFilter(cursor.createdAt);
  const id = quoteFilter(cursor.id);
  return `created_at.gt.${at},and(created_at.eq.${at},id.gt.${id})`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pushPhone(value: unknown, into: string[]) {
  if (typeof value === 'string' && value.trim()) into.push(value.trim());
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const numero = (item as { numero?: unknown }).numero ?? (item as { number?: unknown }).number;
    if (typeof numero === 'string' && numero.trim()) into.push(numero.trim());
  }
}

function pushEmail(value: unknown, into: string[]) {
  if (typeof value === 'string' && value.includes('@')) into.push(value.trim());
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const email = (item as { email?: unknown }).email;
    if (typeof email === 'string' && email.includes('@')) into.push(email.trim());
  }
}

export function audienceFromDirectory(directory: LeadDirectory | null): LeadAudience {
  const leadPhones: string[] = [];
  const leadEmails: string[] = [];
  if (directory) {
    pushPhone(directory.telefone, leadPhones);
    pushPhone(directory.phones, leadPhones);
    pushEmail(directory.email, leadEmails);
    pushEmail(directory.emails, leadEmails);
    for (const contact of directory.contacts ?? []) {
      pushPhone(contact.phones, leadPhones);
      pushEmail(contact.emails, leadEmails);
    }
  }
  return { leadPhones, leadEmails, phonesKnown: true, emailsKnown: true };
}

function blank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * O que o backfill faria com uma interaction.
 * Aviso interno e destino que não é do lead não são copiados.
 * Sem destino gravado, a linha da cadência continua.
 */
export function decideLegacyCopy(row: LegacyInteraction, audience: LeadAudience): CopyDecision {
  const skipReason = text(row.metadata?.skip_reason)?.toLowerCase();
  if (skipReason && NO_PHONE_REASONS.has(skipReason)) return { skip: 'sem telefone do lead' };
  if (isInternalChannelLog(row.metadata, row.message_content)) return { skip: 'aviso interno' };
  if (row.channel !== 'whatsapp' && row.channel !== 'email') return { skip: 'outro canal' };
  if (row.type === 'meeting_scheduled') return { skip: 'reunião' };

  const message = legacyInteractionToMessage(row);
  if (!message) return { skip: 'tipo fora da conversa' };
  if (blank(message.body_text) && blank(message.body_html)) return { skip: 'vazio' };

  const channel = row.channel === 'email' ? 'email' : 'whatsapp';
  if (!isLeadConversation({
    channel,
    metadata: row.metadata,
    content: row.message_content,
    leadPhones: audience.leadPhones,
    leadEmails: audience.leadEmails,
    phonesKnown: audience.phonesKnown,
    emailsKnown: audience.emailsKnown,
  })) {
    if (channel === 'whatsapp' && audience.phonesKnown && audience.leadPhones.length === 0) {
      return { skip: 'sem telefone do lead' };
    }
    if (channel === 'email' && audience.emailsKnown && audience.leadEmails.length === 0) {
      return { skip: 'sem e-mail do lead' };
    }
    return { skip: 'destino não é do lead' };
  }
  return { copy: message };
}

/** Esconde e-mail e telefone no texto impresso. */
export function maskPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '***@***')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 8) return match;
      return `***${digits.slice(-2)}`;
    });
}

export function truncateBody(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

export function formatSample(row: LegacyInteraction, message: LegacyLeadMessage): string {
  const raw = (message.body_text ?? message.body_html ?? '').replace(/<[^>]+>/g, ' ');
  const body = truncateBody(maskPii(raw));
  const address = listedAddresses(row.metadata)[0];
  const dest = address ? ` dest=${maskPii(address)}` : '';
  const direction = message.direction === 'inbound' ? 'entrada' : 'saída';
  return `${message.channel} ${direction} ${message.occurred_at} "${body}"${dest}`;
}

import type { ChatCursor, ChatMessage, ChatSourceRow } from './model';

/**
 * Junta a conversa gravada (lead_messages) com a linha do tempo (interactions).
 *
 * lead_messages só existe desde que a captura foi ligada e não grava todo envio
 * (o WhatsApp mandado pelo SDR quase nunca chega lá). A linha do tempo tem tudo,
 * mas com menos detalhe. A tela mostra as duas e esconde da linha do tempo o que
 * a conversa gravada já mostra.
 */

/** Distância máxima entre o registro da linha do tempo e a mensagem gravada. */
export const SAME_MESSAGE_WINDOW_MS = 120_000;

/** Eventos de status: com a conversa gravada, viram tique e não balão. */
const STATUS_ONLY = new Set(['opened', 'clicked', 'delivered']);

export interface StoredRef {
  id: string;
  provider_message_id: string | null;
  direction: 'inbound' | 'outbound';
  occurred_at: string;
}

export interface TimelineRow extends ChatSourceRow {
  external_id?: string | null;
}

export function isStatusOnly(type: string): boolean {
  return STATUS_ONLY.has(type);
}

function directionOf(type: string): StoredRef['direction'] | null {
  if (type === 'sent') return 'outbound';
  if (type === 'replied') return 'inbound';
  return null;
}

/** Ids da linha do tempo que já aparecem como mensagem gravada (cada gravada casa uma vez). */
export function alreadyStoredIds(rows: TimelineRow[], refs: StoredRef[]): Set<string> {
  const covered = new Set<string>();
  const used = new Set<string>();
  const pending: TimelineRow[] = [];

  const byProviderId = new Map<string, StoredRef>();
  for (const ref of refs) {
    if (ref.provider_message_id) byProviderId.set(ref.provider_message_id, ref);
  }

  for (const row of rows) {
    const direction = directionOf(row.type);
    if (!direction) continue;
    const ref = row.external_id ? byProviderId.get(row.external_id) : undefined;
    if (ref && ref.direction === direction && !used.has(ref.id)) {
      used.add(ref.id);
      covered.add(row.id);
    } else {
      pending.push(row);
    }
  }

  // Pelo horário: casa primeiro os pares mais próximos, para um envio vizinho não roubar o par.
  const pairs: Array<{ row: string; ref: string; gap: number }> = [];
  for (const row of pending) {
    const direction = directionOf(row.type);
    const at = Date.parse(row.created_at);
    for (const ref of refs) {
      if (used.has(ref.id) || ref.direction !== direction) continue;
      const gap = Math.abs(Date.parse(ref.occurred_at) - at);
      if (gap <= SAME_MESSAGE_WINDOW_MS) pairs.push({ row: row.id, ref: ref.id, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  for (const pair of pairs) {
    if (covered.has(pair.row) || used.has(pair.ref)) continue;
    used.add(pair.ref);
    covered.add(pair.row);
  }

  return covered;
}

/** Uma linha lida do banco: `message` nulo quando a linha não vira balão. */
export interface RawEntry {
  at: string;
  id: string;
  message: ChatMessage | null;
}

/** Linhas de uma fonte, da mais nova para a mais antiga, já sem a linha extra do limite. */
export interface StreamPage {
  entries: RawEntry[];
  hasMore: boolean;
}

/** Positivo quando `a` é mais nova que `b` (mesma ordem do banco: data desc, id desc). */
function newer(a: { at: string; id: string }, b: { at: string; id: string }): number {
  const diff = Date.parse(a.at) - Date.parse(b.at);
  if (diff !== 0) return diff;
  if (a.at !== b.at) return a.at > b.at ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id > b.id ? 1 : -1;
}

export interface MergedPage {
  messages: ChatMessage[];
  hasMore: boolean;
  cursor: ChatCursor | null;
}

/**
 * Monta uma página com as duas fontes. Para no ponto mais novo em que alguma fonte
 * ainda tem linhas não lidas, para não pular mensagem entre uma página e outra.
 */
export function mergeStreams(streams: StreamPage[], pageSize: number): MergedPage {
  const all = streams.flatMap((stream) => stream.entries).sort((a, b) => newer(b, a));

  let boundary: RawEntry | null = null;
  for (const stream of streams) {
    const last = stream.entries[stream.entries.length - 1];
    if (!stream.hasMore || !last) continue;
    if (!boundary || newer(last, boundary) > 0) boundary = last;
  }

  const messages: ChatMessage[] = [];
  let cursorEntry: RawEntry | null = null;
  let stoppedEarly = false;

  for (let index = 0; index < all.length; index += 1) {
    const entry = all[index];
    if (!entry) continue;
    if (boundary && newer(entry, boundary) < 0) {
      stoppedEarly = true;
      break;
    }
    cursorEntry = entry;
    if (entry.message) messages.push(entry.message);
    if (messages.length >= pageSize) {
      stoppedEarly = index < all.length - 1;
      break;
    }
  }

  return {
    messages,
    hasMore: stoppedEarly || streams.some((stream) => stream.hasMore),
    cursor: cursorEntry ? { createdAt: cursorEntry.at, id: cursorEntry.id } : null,
  };
}

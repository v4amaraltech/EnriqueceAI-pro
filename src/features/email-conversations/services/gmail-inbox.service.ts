import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { refreshAccessToken, type GmailConnection } from '@/features/integrations/services/email.service';

import { extractPlainText, headersToMap, type InboundHeaders } from './inbound-classifier';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 20_000;

export interface BdrMailbox extends GmailConnection {
  org_id: string;
  user_id: string;
  history_id: string | null;
  last_processed_internal_date: string | null;
  daily_cap: number | null;
  paused_reason: string | null;
}

/** Token válido da caixa (refresh quando expirado/erro). */
export async function getMailboxAccessToken(supabase: SupabaseClient, mailbox: BdrMailbox): Promise<string | null> {
  if (mailbox.status === 'error' || new Date(mailbox.token_expires_at) < new Date()) {
    const r = await refreshAccessToken(mailbox, supabase);
    if ('error' in r) {
      console.error(`[inbox] refresh falhou para ${mailbox.email_address}: ${r.error}`);
      return null;
    }
    return r.accessToken;
  }
  return decrypt(mailbox.access_token_encrypted);
}

async function gmailGet<T>(token: string, path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => `HTTP ${res.status}`) };
  return { ok: true, data: (await res.json()) as T };
}

export interface NewMessagesResult {
  ids: string[];
  historyId: string | null;
  mode: 'history' | 'list';
  historyExpired: boolean;
}

/**
 * Ids de mensagens novas na INBOX. Com `historyId` usa history.list (paginado);
 * 404 (histórico expirado) → recuperação por messages.list desde
 * `afterDate` (último ponto processado − sobreposição), paginada até o fim.
 */
export async function listNewMessageIds(
  token: string,
  { historyId, afterDate }: { historyId: string | null; afterDate: Date },
): Promise<NewMessagesResult> {
  const ids = new Set<string>();
  let historyExpired = false;

  if (historyId) {
    let pageToken: string | undefined;
    let latest: string | null = null;
    let expired = false;
    do {
      const q = new URLSearchParams({ startHistoryId: historyId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '500' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await gmailGet<{ history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>; nextPageToken?: string; historyId?: string }>(
        token, `/history?${q.toString()}`);
      if (!r.ok) {
        if (r.status === 404) { expired = true; break; }
        throw new Error(`history.list ${r.status}: ${r.error}`);
      }
      for (const h of r.data.history ?? []) for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.add(m.message.id);
      latest = r.data.historyId ?? latest;
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    if (!expired) return { ids: [...ids], historyId: latest ?? historyId, mode: 'history', historyExpired: false };
    historyExpired = true;
  }

  // Recuperação: lista desde o último ponto comprovadamente processado (com sobreposição)
  const after = Math.floor(afterDate.getTime() / 1000);
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ q: `after:${after} in:inbox`, maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gmailGet<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, `/messages?${q.toString()}`);
    if (!r.ok) throw new Error(`messages.list ${r.status}: ${r.error}`);
    for (const m of r.data.messages ?? []) ids.add(m.id);
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  const prof = await gmailGet<{ historyId?: string }>(token, `/profile`);
  return { ids: [...ids], historyId: prof.ok ? (prof.data.historyId ?? null) : null, mode: 'list', historyExpired };
}

export interface FullMessage {
  id: string;
  threadId: string;
  internalDate: Date;
  headers: InboundHeaders;
  snippet: string;
  text: string;
  mimeType: string | null;
}

export async function getMessageFull(token: string, id: string): Promise<FullMessage | null> {
  const r = await gmailGet<{
    id: string; threadId: string; internalDate?: string; snippet?: string;
    payload?: { mimeType?: string; headers?: Array<{ name?: string; value?: string }>; body?: { data?: string }; parts?: unknown[] };
  }>(token, `/messages/${id}?format=full`);
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`messages.get ${r.status}: ${r.error}`);
  }
  const m = r.data;
  return {
    id: m.id,
    threadId: m.threadId,
    internalDate: new Date(Number(m.internalDate ?? Date.now())),
    headers: headersToMap(m.payload?.headers),
    snippet: m.snippet ?? '',
    text: extractPlainText(m.payload as never),
    mimeType: m.payload?.mimeType ?? null,
  };
}

/** Conciliação de envio: procura a mensagem pelo Message-ID gerado antes do envio. */
export async function findMessageByRfcId(token: string, rfcMessageId: string): Promise<string | null> {
  const clean = rfcMessageId.replace(/^<|>$/g, '');
  const q = new URLSearchParams({ q: `rfc822msgid:${clean}`, maxResults: '1' });
  const r = await gmailGet<{ messages?: Array<{ id: string }> }>(token, `/messages?${q.toString()}`);
  if (!r.ok) throw new Error(`messages.list(rfc822msgid) ${r.status}: ${r.error}`);
  return r.data.messages?.[0]?.id ?? null;
}

export async function listBdrMailboxes(supabase: SupabaseClient): Promise<BdrMailbox[]> {
  const { data } = (await from(supabase, 'gmail_connections')
    .select('*')
    .eq('bdr_ai', true)
    .in('status', ['connected', 'error'])) as { data: BdrMailbox[] | null };
  return data ?? [];
}

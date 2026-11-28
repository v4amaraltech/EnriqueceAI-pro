'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import { isUuid } from '@/lib/utils/uuid';

import { isLeadConversation } from '@/features/lead-messages/audience';
import { isLeadMessagesCaptureEnabled } from '@/features/lead-messages/flag';

import { CHANNEL_PAGE_SIZE, CHAT_COPY } from './constants';
import { isLeadChannelChatEnabled } from './flag';
import {
  chronological,
  storedLeadMessageToChat,
  toChatMessage,
  type ChatChannel,
  type ChatCursor,
  type ChatMessage,
  type StoredLeadMessage,
} from './model';
import {
  alreadyStoredIds,
  isStatusOnly,
  mergeStreams,
  SAME_MESSAGE_WINDOW_MS,
  type StoredRef,
  type StreamPage,
  type TimelineRow,
} from './merge';

export interface ChannelPage {
  enabled: true;
  messages: ChatMessage[];
  hasMore: boolean;
  cursor: ChatCursor | null;
}

interface LeadAudience {
  leadPhones: string[];
  leadEmails: string[];
  phonesKnown: boolean;
  emailsKnown: boolean;
}

const EMPTY_AUDIENCE: LeadAudience = {
  leadPhones: [],
  leadEmails: [],
  phonesKnown: false,
  emailsKnown: false,
};

function pushPhone(value: unknown, into: string[]) {
  if (typeof value === 'string' && value.trim()) into.push(value.trim());
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const numero = (item as { numero?: unknown; number?: unknown }).numero
      ?? (item as { number?: unknown }).number;
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

async function loadAudience(
  supabase: Parameters<typeof from>[0],
  orgId: string,
  leadId: string,
): Promise<LeadAudience> {
  try {
    const leadRes = (await from(supabase, 'leads')
      .select('telefone, phones, email, emails')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .maybeSingle()) as { data: Record<string, unknown> | null; error: { message: string } | null };
    const contactRes = (await from(supabase, 'lead_contacts')
      .select('phones, emails')
      .eq('lead_id', leadId)
      .eq('org_id', orgId)) as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
    if (leadRes.error) return EMPTY_AUDIENCE;
    const leadPhones: string[] = [];
    const leadEmails: string[] = [];
    if (leadRes.data) {
      pushPhone(leadRes.data.telefone, leadPhones);
      pushPhone(leadRes.data.phones, leadPhones);
      pushEmail(leadRes.data.email, leadEmails);
      pushEmail(leadRes.data.emails, leadEmails);
    }
    for (const contact of contactRes.data ?? []) {
      pushPhone(contact.phones, leadPhones);
      pushEmail(contact.emails, leadEmails);
    }
    return { leadPhones, leadEmails, phonesKnown: true, emailsKnown: true };
  } catch (err) {
    console.error('[lead-chat] telefones do lead:', err instanceof Error ? err.message : err);
    return EMPTY_AUDIENCE;
  }
}

function quote(value: string): string {
  return `"${sanitizeFilterValue(value).replace(/"/g, '')}"`;
}

type Db = Parameters<typeof from>[0];
type PageInput = { leadId: string; channel: ChatChannel; before?: ChatCursor | null };

export async function fetchLeadChannelPage(input: {
  leadId: string;
  channel: ChatChannel;
  before?: ChatCursor | null;
}): Promise<ActionResult<ChannelPage | { enabled: false }>> {
  if (input.channel !== 'whatsapp' && input.channel !== 'email') {
    return { success: false, error: CHAT_COPY.invalidChannel };
  }
  if (!isUuid(input.leadId)) return { success: false, error: CHAT_COPY.invalidLead };
  if (input.before && (!isUuid(input.before.id) || Number.isNaN(Date.parse(input.before.createdAt)))) {
    return { success: false, error: CHAT_COPY.invalidPage };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  if (!(await isLeadChannelChatEnabled(auth.data.orgId))) {
    return { success: true, data: { enabled: false } };
  }

  const { supabase, orgId } = auth.data;
  const audience = await loadAudience(supabase, orgId, input.leadId);

  const timeline = await fetchTimeline(supabase, orgId, input);
  if (!timeline) return { success: false, error: CHAT_COPY.error };

  if (await isLeadMessagesCaptureEnabled(orgId)) {
    const stored = await fetchStored(supabase, orgId, input, audience);
    if (stored) {
      const merged = await mergeWithTimeline(supabase, orgId, input, audience, stored, timeline);
      return { success: true, data: { enabled: true, ...merged, messages: chronological(merged.messages) } };
    }
  }

  const page = mergeStreams([timelineStream(timeline, input.channel, audience, null)], CHANNEL_PAGE_SIZE);
  return { success: true, data: { enabled: true, ...page, messages: chronological(page.messages) } };
}

interface TimelineFetch {
  rows: TimelineRow[];
  hasMore: boolean;
}

async function fetchTimeline(db: Db, orgId: string, input: PageInput): Promise<TimelineFetch | null> {
  let query = from(db, 'interactions')
    .select('id, type, channel, message_content, metadata, ai_generated, created_at, external_id')
    .eq('lead_id', input.leadId)
    .eq('org_id', orgId)
    .eq('channel', input.channel)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CHANNEL_PAGE_SIZE + 1);

  if (input.before) {
    const at = quote(input.before.createdAt);
    const id = quote(input.before.id);
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`);
  }

  const { data, error } = (await query) as {
    data: TimelineRow[] | null;
    error: { message: string } | null;
  };
  if (error) return null;
  const rows = data ?? [];
  return { rows: rows.slice(0, CHANNEL_PAGE_SIZE), hasMore: rows.length > CHANNEL_PAGE_SIZE };
}

/** `covered`: linhas que a conversa gravada já mostra. Nulo = só linha do tempo (captura desligada). */
function timelineStream(
  timeline: TimelineFetch,
  channel: ChatChannel,
  audience: LeadAudience,
  covered: Set<string> | null,
): StreamPage {
  return {
    hasMore: timeline.hasMore,
    entries: timeline.rows.map((row) => {
      const hidden = covered !== null && (covered.has(row.id) || isStatusOnly(row.type));
      return {
        at: row.created_at,
        id: row.id,
        message: hidden ? null : toChatMessage({ ...row, channel }, audience),
      };
    }),
  };
}

interface StoredFetch {
  stream: StreamPage;
}

async function fetchStored(
  db: Db,
  orgId: string,
  input: PageInput,
  audience: LeadAudience,
): Promise<StoredFetch | null> {
  try {
    let query = from(db, 'lead_messages')
      .select('id, channel, direction, body_text, body_html, subject, media, thread_id, ai_generated, occurred_at, lead_address')
      .eq('lead_id', input.leadId)
      .eq('org_id', orgId)
      .eq('channel', input.channel)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CHANNEL_PAGE_SIZE + 1);

    if (input.before) {
      const at = quote(input.before.createdAt);
      const id = quote(input.before.id);
      query = query.or(`occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${id})`);
    }

    const { data, error } = (await query) as {
      data: Array<StoredLeadMessage & { lead_address?: string | null }> | null;
      error: { message: string } | null;
    };
    if (error) return null;

    const rows = data ?? [];
    const page = rows.slice(0, CHANNEL_PAGE_SIZE);
    const ids = page.map((row) => row.id);
    const statuses = new Map<string, string>();
    if (ids.length > 0) {
      const { data: events } = (await from(db, 'lead_message_status_events')
        .select('message_id, status, occurred_at')
        .in('message_id', ids)
        .order('occurred_at', { ascending: false })) as {
        data: Array<{ message_id: string; status: string }> | null;
      };
      for (const event of events ?? []) {
        if (!statuses.has(event.message_id)) statuses.set(event.message_id, event.status);
      }
    }

    return {
      stream: {
        hasMore: rows.length > CHANNEL_PAGE_SIZE,
        entries: page.map((row) => ({
          at: row.occurred_at,
          id: row.id,
          message: isLeadConversation({
            channel: input.channel,
            content: row.body_text,
            explicitAddress: row.lead_address,
            ...audience,
          })
            ? storedLeadMessageToChat({ ...row, channel: input.channel }, statuses.get(row.id) ?? null)
            : null,
        })),
      },
    };
  } catch (err) {
    console.error('[lead-messages] leitura caiu para interactions:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Mensagens gravadas perto dos registros da página, para não mostrar o mesmo envio duas vezes.
 * Consulta à parte: a mensagem gravada pode estar na página seguinte da outra fonte.
 */
async function storedRefsAround(db: Db, orgId: string, input: PageInput, rows: TimelineRow[]): Promise<StoredRef[]> {
  const times = rows.map((row) => Date.parse(row.created_at)).filter((time) => !Number.isNaN(time));
  if (times.length === 0) return [];
  const start = new Date(Math.min(...times) - SAME_MESSAGE_WINDOW_MS).toISOString();
  const end = new Date(Math.max(...times) + SAME_MESSAGE_WINDOW_MS).toISOString();
  const { data, error } = (await from(db, 'lead_messages')
    .select('id, provider_message_id, direction, occurred_at')
    .eq('lead_id', input.leadId)
    .eq('org_id', orgId)
    .eq('channel', input.channel)
    .gte('occurred_at', start)
    .lte('occurred_at', end)) as { data: StoredRef[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function mergeWithTimeline(
  db: Db,
  orgId: string,
  input: PageInput,
  audience: LeadAudience,
  stored: StoredFetch,
  timeline: TimelineFetch,
) {
  let covered: Set<string>;
  try {
    covered = alreadyStoredIds(timeline.rows, await storedRefsAround(db, orgId, input, timeline.rows));
  } catch (err) {
    // Sem como casar: mostra só a conversa gravada, como antes, em vez de duplicar.
    console.error('[lead-chat] casamento com a linha do tempo:', err instanceof Error ? err.message : err);
    return mergeStreams([stored.stream], CHANNEL_PAGE_SIZE);
  }
  return mergeStreams(
    [stored.stream, timelineStream(timeline, input.channel, audience, covered)],
    CHANNEL_PAGE_SIZE,
  );
}

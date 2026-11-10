'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import { isUuid } from '@/lib/utils/uuid';

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
  type ChatSourceRow,
  type StoredLeadMessage,
} from './model';

export interface ChannelPage {
  enabled: true;
  messages: ChatMessage[];
  hasMore: boolean;
  cursor: ChatCursor | null;
}

function quote(value: string): string {
  return `"${sanitizeFilterValue(value).replace(/"/g, '')}"`;
}

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

  if (await isLeadMessagesCaptureEnabled(auth.data.orgId)) {
    const stored = await fetchStoredMessages(auth.data.supabase, auth.data.orgId, input);
    if (stored) return stored;
  }

  return fetchInteractions(auth.data.supabase, auth.data.orgId, input);
}

async function fetchInteractions(
  supabase: Parameters<typeof from>[0],
  orgId: string,
  input: { leadId: string; channel: ChatChannel; before?: ChatCursor | null },
): Promise<ActionResult<ChannelPage>> {
  let query = from(supabase, 'interactions')
    .select('id, type, channel, message_content, metadata, ai_generated, created_at')
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
    data: ChatSourceRow[] | null;
    error: { message: string } | null;
  };
  if (error) return { success: false, error: CHAT_COPY.error };

  const rows = data ?? [];
  const hasMore = rows.length > CHANNEL_PAGE_SIZE;
  const page = rows.slice(0, CHANNEL_PAGE_SIZE);
  const messages = chronological(
    page.flatMap((row) => {
      const message = toChatMessage({ ...row, channel: input.channel });
      return message ? [message] : [];
    }),
  );
  const oldest = page[page.length - 1];
  return {
    success: true,
    data: {
      enabled: true,
      messages,
      hasMore,
      cursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
    },
  };
}

async function fetchStoredMessages(
  supabase: Parameters<typeof from>[0],
  orgId: string,
  input: { leadId: string; channel: ChatChannel; before?: ChatCursor | null },
): Promise<ActionResult<ChannelPage> | null> {
  try {
    let query = from(supabase, 'lead_messages')
      .select('id, channel, direction, body_text, body_html, subject, media, thread_id, ai_generated, occurred_at')
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

    const { data, error } = (await query) as { data: StoredLeadMessage[] | null; error: { message: string } | null };
    if (error) return null;

    const rows = data ?? [];
    const hasMore = rows.length > CHANNEL_PAGE_SIZE;
    const page = rows.slice(0, CHANNEL_PAGE_SIZE);
    const ids = page.map((row) => row.id);
    const statuses = new Map<string, string>();
    if (ids.length > 0) {
      const { data: events } = (await from(supabase, 'lead_message_status_events')
        .select('message_id, status, occurred_at')
        .in('message_id', ids)
        .order('occurred_at', { ascending: false })) as {
        data: Array<{ message_id: string; status: string }> | null;
      };
      for (const event of events ?? []) {
        if (!statuses.has(event.message_id)) statuses.set(event.message_id, event.status);
      }
    }

    const oldest = page[page.length - 1];
    return {
      success: true,
      data: {
        enabled: true,
        messages: chronological(page.map((row) => storedLeadMessageToChat(
          { ...row, channel: input.channel },
          statuses.get(row.id) ?? null,
        ))),
        hasMore,
        cursor: oldest ? { createdAt: oldest.occurred_at, id: oldest.id } : null,
      },
    };
  } catch (err) {
    console.error('[lead-messages] leitura caiu para interactions:', err instanceof Error ? err.message : err);
    return null;
  }
}

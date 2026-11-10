'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import { isUuid } from '@/lib/utils/uuid';

import { CHANNEL_PAGE_SIZE, CHAT_COPY } from './constants';
import { isLeadChannelChatEnabled } from './flag';
import {
  chronological,
  toChatMessage,
  type ChatChannel,
  type ChatCursor,
  type ChatMessage,
  type ChatSourceRow,
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

  let query = from(auth.data.supabase, 'interactions')
    .select('id, type, channel, message_content, metadata, ai_generated, created_at')
    .eq('lead_id', input.leadId)
    .eq('org_id', auth.data.orgId)
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

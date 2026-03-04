'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { decrypt } from '@/lib/security/encryption';
import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  type GmailConnection,
  refreshAccessToken,
} from '@/features/integrations/services/email.service';

const REPLY_CHECK_DAYS = 30;
const BATCH_SIZE = 100;

interface SentInteraction {
  id: string;
  lead_id: string;
  cadence_id: string;
  external_id: string;
  metadata: Record<string, unknown> | null;
}

interface CadenceCreator {
  id: string;
  created_by: string;
}

/**
 * Checks Gmail threads for replies to sent email interactions.
 * Runs via cron — uses service role (no cookies).
 */
export async function checkEmailReplies(): Promise<ActionResult<{ found: number }>> {
  const supabase = createServiceRoleClient();
  let found = 0;

  // 1. Fetch sent email interactions from the last N days that have an external_id
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - REPLY_CHECK_DAYS);

  const { data: sentInteractions, error: fetchError } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('id, lead_id, cadence_id, external_id, metadata')
    .eq('type', 'sent')
    .eq('channel', 'email')
    .not('external_id', 'is', null)
    .gte('created_at', cutoffDate.toISOString())
    .limit(BATCH_SIZE)) as { data: SentInteraction[] | null; error: { message: string } | null };

  if (fetchError || !sentInteractions?.length) {
    if (fetchError) {
      console.error('[reply-check] Failed to fetch interactions:', fetchError.message);
      return { success: false, error: fetchError.message };
    }
    return { success: true, data: { found: 0 } };
  }

  // 2. Filter out interactions that already have a 'replied' or 'bounced' counterpart (batch query)
  const cadenceLeadPairs = sentInteractions.map((i) => `${i.cadence_id}:${i.lead_id}`);
  const uniquePairs = [...new Set(cadenceLeadPairs)];

  const alreadyProcessedMap = new Set<string>();

  const uniqueCadenceIds = [...new Set(sentInteractions.map((i) => i.cadence_id))];
  const uniqueLeadIds = [...new Set(sentInteractions.map((i) => i.lead_id))];

  const { data: processedInteractions } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('cadence_id, lead_id')
    .in('cadence_id', uniqueCadenceIds)
    .in('lead_id', uniqueLeadIds)
    .in('type', ['replied', 'bounced'])) as { data: Array<{ cadence_id: string; lead_id: string }> | null };

  for (const pi of processedInteractions ?? []) {
    alreadyProcessedMap.add(`${pi.cadence_id}:${pi.lead_id}`);
  }

  const toCheck = sentInteractions.filter(
    (i) => !alreadyProcessedMap.has(`${i.cadence_id}:${i.lead_id}`),
  );

  if (!toCheck.length) {
    return { success: true, data: { found: 0 } };
  }

  // 3. Group by cadence → get created_by (the Gmail user)
  const cadenceIds = [...new Set(toCheck.map((i) => i.cadence_id))];
  const { data: cadences } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, created_by')
    .in('id', cadenceIds)) as { data: CadenceCreator[] | null };

  if (!cadences?.length) {
    return { success: true, data: { found: 0 } };
  }

  const cadenceCreatorMap = new Map<string, string>();
  for (const c of cadences) {
    if (c.created_by) {
      cadenceCreatorMap.set(c.id, c.created_by);
    }
  }

  // 4. Group interactions by user_id → process per user's Gmail
  const byUser = new Map<string, SentInteraction[]>();
  for (const interaction of toCheck) {
    const userId = cadenceCreatorMap.get(interaction.cadence_id);
    if (!userId) continue;
    const list = byUser.get(userId) ?? [];
    list.push(interaction);
    byUser.set(userId, list);
  }

  // 5. For each user, get Gmail connection and check threads
  for (const [userId, interactions] of byUser) {
    const accessToken = await getValidAccessToken(supabase, userId);
    if (!accessToken) {
      console.error(`[reply-check] No valid Gmail token for user=${userId}`);
      continue;
    }

    // Process interactions in parallel batches of 5 to avoid Gmail rate limits
    const PARALLEL_BATCH = 5;
    for (let i = 0; i < interactions.length; i += PARALLEL_BATCH) {
      const batch = interactions.slice(i, i + PARALLEL_BATCH);
      const results = await Promise.allSettled(
        batch.map(async (interaction) => {
          const threadId = await getThreadId(supabase, interaction, accessToken);
          if (!threadId) return;

          const detection = await checkThreadForReplyOrBounce(threadId, accessToken);
          if (!detection) return;

          if (detection === 'bounce') {
            await recordBounce(supabase, interaction);
            found++;
            console.warn(`[reply-check] Bounce detected: interaction=${interaction.id} lead=${interaction.lead_id} cadence=${interaction.cadence_id}`);
          } else {
            await recordReply(supabase, interaction);
            found++;
            console.warn(`[reply-check] Reply found: interaction=${interaction.id} lead=${interaction.lead_id} cadence=${interaction.cadence_id}`);
          }
        }),
      );
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[reply-check] Batch item failed:', r.reason);
        }
      }
    }
  }

  console.warn(`[reply-check] Complete: checked=${toCheck.length} found=${found}`);
  return { success: true, data: { found } };
}

/** Get a valid access token for a user's Gmail connection, refreshing if needed */
async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // Get the user's org first
  const { data: member } = (await (supabase
    .from('organization_members') as ReturnType<typeof supabase.from>)
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()) as { data: { org_id: string } | null };

  if (!member) return null;

  const { data: connection } = (await (supabase
    .from('gmail_connections') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('org_id', member.org_id)
    .eq('user_id', userId)
    .in('status', ['connected', 'error'])
    .maybeSingle()) as { data: GmailConnection | null };

  if (!connection) return null;

  // Check if token is expired
  if (connection.status === 'error' || new Date(connection.token_expires_at) < new Date()) {
    const refreshResult = await refreshAccessToken(connection, supabase);
    if ('error' in refreshResult) return null;
    return refreshResult.accessToken;
  }

  return decrypt(connection.access_token_encrypted);
}

/** Get the threadId for an interaction, from metadata cache or Gmail API */
async function getThreadId(
  supabase: SupabaseClient,
  interaction: SentInteraction,
  accessToken: string,
): Promise<string | null> {
  // Check cached threadId in metadata
  const cachedThreadId = interaction.metadata?.thread_id as string | undefined;
  if (cachedThreadId) return cachedThreadId;

  // Fetch from Gmail API
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${interaction.external_id}?fields=threadId`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { threadId?: string };
    const threadId = data.threadId ?? null;

    // Cache the threadId for next time
    if (threadId) {
      const existingMeta = interaction.metadata ?? {};
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update({
          metadata: { ...existingMeta, thread_id: threadId },
        } as Record<string, unknown>)
        .eq('id', interaction.id);
    }

    return threadId;
  } catch {
    return null;
  }
}

/** Bounce indicator patterns in email From header */
const BOUNCE_SENDERS = ['mailer-daemon', 'postmaster', 'mail delivery', 'delivery status'];

/** Auto-reply indicator patterns in Subject header */
const AUTO_REPLY_SUBJECTS = [
  'out of office',
  'fora do escritório',
  'fora do escritorio',
  'automatic reply',
  'resposta automática',
  'resposta automatica',
  'auto-reply',
  'autoreply',
  'vacation',
  'férias',
  'ferias',
  'away from office',
  'ausência',
  'ausencia',
];

/** Auto-reply indicator headers */
const AUTO_REPLY_HEADERS = ['x-autoreply', 'x-autorespond', 'auto-submitted'];

interface GmailThreadMessage {
  id: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

/** Check if a Gmail thread contains a reply or a bounce */
async function checkThreadForReplyOrBounce(
  threadId: string,
  accessToken: string,
): Promise<'reply' | 'bounce' | null> {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?fields=messages(id,payload(headers))`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { messages?: GmailThreadMessage[] };
    const messages = data.messages ?? [];
    if (messages.length <= 1) return null;

    let hasGenuineReply = false;

    // Check each reply message (beyond the first sent message)
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      const headers = msg?.payload?.headers ?? [];

      const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from');
      const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject');

      // Check bounce
      if (fromHeader) {
        const fromLower = fromHeader.value.toLowerCase();
        if (BOUNCE_SENDERS.some((sender) => fromLower.includes(sender))) {
          return 'bounce';
        }
      }

      // Check auto-reply headers (X-Autoreply, Auto-Submitted, etc.)
      const isAutoReplyHeader = headers.some((h) => {
        const name = h.name.toLowerCase();
        if (AUTO_REPLY_HEADERS.includes(name)) return true;
        if (name === 'auto-submitted' && h.value.toLowerCase() !== 'no') return true;
        if (name === 'x-auto-response-suppress') return true;
        return false;
      });
      if (isAutoReplyHeader) continue;

      // Check auto-reply subject patterns
      if (subjectHeader) {
        const subjectLower = subjectHeader.value.toLowerCase();
        const isAutoReplySubject = AUTO_REPLY_SUBJECTS.some((pattern) => subjectLower.includes(pattern));
        if (isAutoReplySubject) continue;
      }

      // This message looks like a genuine reply
      hasGenuineReply = true;
    }

    return hasGenuineReply ? 'reply' : null;
  } catch {
    return null;
  }
}

/** Record a reply: create replied interaction + update enrollment status */
async function recordReply(
  supabase: SupabaseClient,
  sentInteraction: SentInteraction,
): Promise<void> {
  // Get org_id from the lead
  const { data: lead } = (await (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
    .select('org_id')
    .eq('id', sentInteraction.lead_id)
    .single()) as { data: { org_id: string } | null };

  if (!lead) return;

  // Create replied interaction
  await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .insert({
      org_id: lead.org_id,
      lead_id: sentInteraction.lead_id,
      cadence_id: sentInteraction.cadence_id,
      step_id: null,
      channel: 'email',
      type: 'replied',
      message_content: null,
      metadata: { detected_by: 'gmail_thread_poll', sent_interaction_id: sentInteraction.id },
    } as Record<string, unknown>);

  // Update active enrollment to replied
  await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .update({ status: 'replied' } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('cadence_id', sentInteraction.cadence_id)
    .eq('status', 'active');
}

/** Record a bounce: create bounced interaction + update enrollment status */
async function recordBounce(
  supabase: SupabaseClient,
  sentInteraction: SentInteraction,
): Promise<void> {
  // Get org_id from the lead
  const { data: lead } = (await (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
    .select('org_id')
    .eq('id', sentInteraction.lead_id)
    .single()) as { data: { org_id: string } | null };

  if (!lead) return;

  // Create bounced interaction
  await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .insert({
      org_id: lead.org_id,
      lead_id: sentInteraction.lead_id,
      cadence_id: sentInteraction.cadence_id,
      step_id: null,
      channel: 'email',
      type: 'bounced',
      message_content: null,
      metadata: { detected_by: 'gmail_thread_poll', sent_interaction_id: sentInteraction.id },
    } as Record<string, unknown>);

  // Update active enrollment to bounced
  await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .update({ status: 'bounced' } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('cadence_id', sentInteraction.cadence_id)
    .eq('status', 'active');
}

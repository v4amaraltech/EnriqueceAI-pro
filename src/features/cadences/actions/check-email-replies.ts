'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { decrypt } from '@/lib/security/encryption';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';

import {
  type GmailConnection,
  refreshAccessToken,
} from '@/features/integrations/services/email.service';
import { createNotification } from '@/features/notifications/services/notification.service';

import { dispatchWebhookEvent } from '../services/webhook-dispatch.service';

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

  const { data: sentInteractions, error: fetchError } = (await from(supabase, 'interactions')
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
  const _uniquePairs = [...new Set(cadenceLeadPairs)];

  const alreadyProcessedMap = new Set<string>();

  const uniqueCadenceIds = [...new Set(sentInteractions.map((i) => i.cadence_id))];
  const uniqueLeadIds = [...new Set(sentInteractions.map((i) => i.lead_id))];

  const { data: processedInteractions } = (await from(supabase, 'interactions')
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
    console.warn(`[reply-check] All ${sentInteractions.length} interactions already processed`);
    return { success: true, data: { found: 0 } };
  }

  console.warn(`[reply-check] Checking ${toCheck.length} interactions (${sentInteractions.length} total sent, ${alreadyProcessedMap.size} already processed)`);

  // 3. Group by cadence → get created_by (the Gmail user)
  const cadenceIds = [...new Set(toCheck.map((i) => i.cadence_id))];
  const { data: cadences } = (await from(supabase, 'cadences')
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

  console.warn(`[reply-check] Users to check: ${byUser.size}`);

  // 5. For each user, get Gmail connection and check threads
  for (const [userId, interactions] of byUser) {
    console.warn(`[reply-check] Processing user=${userId} interactions=${interactions.length}`);
    const accessToken = await getValidAccessToken(supabase, userId);
    if (!accessToken) {
      console.error(`[reply-check] No valid Gmail token for user=${userId} — skipping ${interactions.length} interactions`);
      continue;
    }
    console.warn(`[reply-check] Got valid token for user=${userId}, checking ${interactions.length} threads...`);

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
            await checkAndAutoBlacklistDomain(supabase, interaction);
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
  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()) as { data: { org_id: string } | null };

  if (!member) return null;

  const { data: connection } = (await from(supabase, 'gmail_connections')
    .select('*')
    .eq('org_id', member.org_id)
    .eq('user_id', userId)
    .in('status', ['connected', 'error'])
    .maybeSingle()) as { data: GmailConnection | null };

  if (!connection) {
    console.warn(`[reply-check] No Gmail connection for user=${userId}`);
    return null;
  }

  // Check if token is expired
  if (connection.status === 'error' || new Date(connection.token_expires_at) < new Date()) {
    console.warn(`[reply-check] Token expired for user=${userId}, refreshing...`);
    const refreshResult = await refreshAccessToken(connection, supabase);
    if ('error' in refreshResult) {
      console.error(`[reply-check] Token refresh failed for user=${userId}:`, refreshResult.error);
      return null;
    }
    console.warn(`[reply-check] Token refreshed for user=${userId}`);
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
      await from(supabase, 'interactions')
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
  const { data: lead } = (await from(supabase, 'leads')
    .select('org_id')
    .eq('id', sentInteraction.lead_id)
    .single()) as { data: { org_id: string } | null };

  if (!lead) return;

  // Create replied interaction
  await from(supabase, 'interactions')
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
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'replied' } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('cadence_id', sentInteraction.cadence_id)
    .eq('status', 'active');

  dispatchWebhookEvent(supabase, lead.org_id, 'email.replied', {
    lead_id: sentInteraction.lead_id,
    cadence_id: sentInteraction.cadence_id,
    interaction_id: sentInteraction.id,
  });
}

/** Record a bounce: create bounced interaction, mark lead, pause ALL enrollments, notify SDR */
async function recordBounce(
  supabase: SupabaseClient,
  sentInteraction: SentInteraction,
): Promise<void> {
  // Get lead details
  const { data: lead } = (await from(supabase, 'leads')
    .select('org_id, nome_fantasia, razao_social, cnpj, email, assigned_to')
    .eq('id', sentInteraction.lead_id)
    .single()) as { data: { org_id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null; email: string | null; assigned_to: string | null } | null };

  if (!lead) return;

  // 1. Create bounced interaction
  await from(supabase, 'interactions')
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

  // 2. Mark lead email as bounced
  await from(supabase, 'leads')
    .update({ email_bounced_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', sentInteraction.lead_id);

  // 3. Bounce the enrollment in the originating cadence
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'bounced' } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('cadence_id', sentInteraction.cadence_id)
    .eq('status', 'active');

  // 4. Pause ALL other active enrollments for this lead across all cadences
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'paused' } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('status', 'active')
    .neq('cadence_id', sentInteraction.cadence_id);

  dispatchWebhookEvent(supabase, lead.org_id, 'email.bounced', {
    lead_id: sentInteraction.lead_id,
    cadence_id: sentInteraction.cadence_id,
    interaction_id: sentInteraction.id,
    email: lead.email,
  });

  console.warn('[reply-check] Bounce detected — marked bounced + paused all enrollments');

  // 5. Notify SDR
  if (lead.assigned_to) {
    const leadName = lead.nome_fantasia || lead.razao_social || lead.cnpj || 'Lead';
    try {
      await createNotification({
        org_id: lead.org_id,
        user_id: lead.assigned_to,
        type: 'lead_bounced',
        title: `Email bounce — ${leadName}`,
        body: `O email "${lead.email}" retornou bounce. Todos os enrollments deste lead foram pausados. Atualize o email do lead para retomar as cadências.`,
        resource_type: 'lead',
        resource_id: sentInteraction.lead_id,
        metadata: { cadence_id: sentInteraction.cadence_id, email: lead.email },
      });
    } catch (notifErr) {
      console.error(`[reply-check] Failed to notify bounce for lead=${sentInteraction.lead_id}:`, notifErr);
    }
  }
}

/** Minimum bounces required before auto-blacklisting a domain */
const AUTO_BLACKLIST_MIN_BOUNCES = 3;
/** Minimum bounce rate (bounces / total sent) to trigger auto-blacklist */
const AUTO_BLACKLIST_BOUNCE_RATE = 0.5;

/**
 * After recording a bounce, check if the domain should be auto-blacklisted.
 * Criteria: >= 3 bounces AND >= 50% bounce rate for that domain within the org.
 */
async function checkAndAutoBlacklistDomain(
  supabase: SupabaseClient,
  sentInteraction: SentInteraction,
): Promise<void> {
  try {
    // Get lead's email and org
    const { data: lead } = (await from(supabase, 'leads')
      .select('org_id, email')
      .eq('id', sentInteraction.lead_id)
      .single()) as { data: { org_id: string; email: string | null } | null };

    if (!lead?.email) return;

    const domain = lead.email.split('@')[1]?.toLowerCase();
    if (!domain) return;

    // Check if domain is already blacklisted
    const { data: existing } = (await from(supabase, 'email_blacklist')
      .select('id')
      .eq('org_id', lead.org_id)
      .eq('domain', domain)
      .maybeSingle()) as { data: { id: string } | null };

    if (existing) return; // already blacklisted

    // Get all leads with this domain in this org
    const { data: domainLeads } = (await from(supabase, 'leads')
      .select('id')
      .eq('org_id', lead.org_id)
      .ilike('email', `%@${domain}`)) as { data: Array<{ id: string }> | null };

    if (!domainLeads?.length) return;

    const leadIds = domainLeads.map((l) => l.id);

    // Count total sent emails to this domain
    const { count: totalSent } = (await from(supabase, 'interactions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', lead.org_id)
      .eq('channel', 'email')
      .eq('type', 'sent')
      .in('lead_id', leadIds)) as { count: number | null };

    // Count total bounces for this domain
    const { count: totalBounced } = (await from(supabase, 'interactions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', lead.org_id)
      .eq('channel', 'email')
      .eq('type', 'bounced')
      .in('lead_id', leadIds)) as { count: number | null };

    const sent = totalSent ?? 0;
    const bounced = totalBounced ?? 0;

    if (bounced < AUTO_BLACKLIST_MIN_BOUNCES) return;
    if (sent === 0) return;

    const bounceRate = bounced / sent;
    if (bounceRate < AUTO_BLACKLIST_BOUNCE_RATE) return;

    // Auto-blacklist the domain
    await from(supabase, 'email_blacklist')
      .insert({
        org_id: lead.org_id,
        domain,
        reason: `Auto-blacklist: ${bounced}/${sent} bounces (${Math.round(bounceRate * 100)}%)`,
      } as Record<string, unknown>);

    console.warn(`[reply-check] Auto-blacklisted domain=${domain} org=${lead.org_id} bounces=${bounced}/${sent} rate=${Math.round(bounceRate * 100)}%`);

    // Notify managers about the auto-blacklist
    try {
      const { data: managers } = (await from(supabase, 'organization_members')
        .select('user_id')
        .eq('org_id', lead.org_id)
        .eq('role', 'manager')
        .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

      for (const manager of managers ?? []) {
        await createNotification({
          org_id: lead.org_id,
          user_id: manager.user_id,
          type: 'integration_error',
          title: `Domínio bloqueado automaticamente — @${domain}`,
          body: `O domínio @${domain} foi adicionado à blacklist automaticamente por taxa de bounce alta (${bounced}/${sent} emails, ${Math.round(bounceRate * 100)}%). Emails futuros para este domínio não serão enviados.`,
          resource_type: 'organization',
          resource_id: lead.org_id,
          metadata: { domain, bounced, sent, bounce_rate: bounceRate, auto_blacklisted: true },
        });
      }
    } catch (notifErr) {
      console.error(`[reply-check] Failed to notify auto-blacklist for domain=${domain}:`, notifErr);
    }
  } catch (err) {
    console.error(`[reply-check] Auto-blacklist check failed for interaction=${sentInteraction.id}:`, err);
  }
}

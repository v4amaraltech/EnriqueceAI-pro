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

import { checkThreadForReplyOrBounce, mailboxCandidates } from '../services/reply-detection.service';
import { dispatchWebhookEvent } from '../services/webhook-dispatch.service';

const REPLY_CHECK_DAYS = 30;
// ~1.2k sent emails sit in the 30-day window and the cron runs every 10 min,
// so rotating 100 per run re-checks every thread roughly every 2 hours.
const BATCH_SIZE = 100;
const PARALLEL_BATCH = 5;

interface SentInteraction {
  id: string;
  lead_id: string;
  cadence_id: string;
  step_id: string | null;
  external_id: string;
  metadata: Record<string, unknown> | null;
  performed_by: string | null;
}

/**
 * Checks Gmail threads for replies to sent email interactions.
 * Runs via cron — uses service role (no cookies).
 */
export async function checkEmailReplies(): Promise<ActionResult<{ found: number }>> {
  const supabase = createServiceRoleClient();
  let found = 0;

  // 1. Fetch sent email interactions from the last N days that have an external_id.
  // Rotation: least-recently-checked first (never checked = NULL first). Without
  // an order the same arbitrary 100 rows came back every run and the rest of the
  // window was never inspected.
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - REPLY_CHECK_DAYS);

  const { data: sentInteractions, error: fetchError } = (await from(supabase, 'interactions')
    .select('id, lead_id, cadence_id, step_id, external_id, metadata, performed_by')
    .eq('type', 'sent')
    .eq('channel', 'email')
    .not('external_id', 'is', null)
    .not('performed_by', 'is', null)
    .gte('created_at', cutoffDate.toISOString())
    .order('metadata->>reply_checked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)) as { data: SentInteraction[] | null; error: { message: string } | null };

  if (fetchError || !sentInteractions?.length) {
    if (fetchError) {
      console.error('[reply-check] Failed to fetch interactions:', fetchError.message);
      return { success: false, error: fetchError.message };
    }
    return { success: true, data: { found: 0 } };
  }

  // Every fetched row is stamped at the end — including the ones skipped below —
  // so the rotation moves past them instead of re-fetching them forever.
  const checkedAt = new Date().toISOString();
  const metaPatches = new Map<string, Record<string, unknown>>(
    sentInteractions.map((i) => [i.id, { reply_checked_at: checkedAt }]),
  );

  // 2a. Primary guard — drop interactions whose lead is already flagged
  // bounced. Without this, V4 Amaral hit a loop where the same 4 archived
  // leads (japescuma, mhbgrejao, fhytfhjii, dogaah) generated 12 bounce
  // notifications per hour: the existing dedup below was failing silently
  // (PostgREST `.in()` with a NULL inside the array short-circuits the
  // whole filter), so every cron run re-recorded the bounce. Stopping at
  // the lead level is cheaper and authoritative — a bounced email doesn't
  // un-bounce. The same query brings the lead owner (mailbox fallback).
  const sentLeadIds = [...new Set(sentInteractions.map((i) => i.lead_id))];
  const { data: sentLeads } = (await from(supabase, 'leads')
    .select('id, assigned_to, email_bounced_at')
    .in('id', sentLeadIds)) as {
    data: Array<{ id: string; assigned_to: string | null; email_bounced_at: string | null }> | null;
  };
  const leadOwner = new Map<string, string | null>();
  const bouncedLeadIds = new Set<string>();
  for (const l of sentLeads ?? []) {
    leadOwner.set(l.id, l.assigned_to);
    if (l.email_bounced_at) bouncedLeadIds.add(l.id);
  }
  if (bouncedLeadIds.size > 0) {
    console.warn(`[reply-check] Skipping ${bouncedLeadIds.size} leads with email_bounced_at already set`);
  }

  // 2b. Secondary guard — filter interactions whose (cadence_id, lead_id)
  // pair already has a 'replied' or 'bounced' counterpart. Strip nulls from
  // the .in() arrays so a single sent row with cadence_id=NULL doesn't
  // poison the whole filter at the PostgREST layer.
  const alreadyProcessedMap = new Set<string>();
  const uniqueCadenceIds = [...new Set(sentInteractions.map((i) => i.cadence_id).filter((v): v is string => v != null))];
  const uniqueLeadIds = [...new Set(sentInteractions.map((i) => i.lead_id).filter((v): v is string => v != null))];

  if (uniqueCadenceIds.length > 0 && uniqueLeadIds.length > 0) {
    const { data: processedInteractions } = (await from(supabase, 'interactions')
      .select('cadence_id, lead_id')
      .in('cadence_id', uniqueCadenceIds)
      .in('lead_id', uniqueLeadIds)
      .in('type', ['replied', 'bounced'])) as { data: Array<{ cadence_id: string; lead_id: string }> | null };

    for (const pi of processedInteractions ?? []) {
      alreadyProcessedMap.add(`${pi.cadence_id}:${pi.lead_id}`);
    }
  }

  const toCheck = sentInteractions.filter((i) => {
    if (bouncedLeadIds.has(i.lead_id)) return false;
    return !alreadyProcessedMap.has(`${i.cadence_id}:${i.lead_id}`);
  });

  console.warn(`[reply-check] Checking ${toCheck.length} interactions (${sentInteractions.length} fetched, ${alreadyProcessedMap.size} already processed)`);

  // 3. One token lookup per mailbox per run, shared by the parallel batches.
  const tokenCache = new Map<string, Promise<string | null>>();
  const tokenFor = (userId: string) => {
    let token = tokenCache.get(userId);
    if (!token) {
      token = getValidAccessToken(supabase, userId);
      tokenCache.set(userId, token);
    }
    return token;
  };

  // The same lead can show up with several sent rows in one batch — record its
  // reply/bounce once.
  const recordedPairs = new Set<string>();

  const inspect = async (interaction: SentInteraction) => {
    const candidates = mailboxCandidates(interaction, leadOwner.get(interaction.lead_id) ?? null);

    for (const userId of candidates) {
      const accessToken = await tokenFor(userId);
      if (!accessToken) continue;

      const threadId = await getThreadId(interaction, accessToken);
      if (!threadId) continue; // message not in this mailbox

      const detection = await checkThreadForReplyOrBounce(threadId, accessToken);
      if (detection === 'not_found') continue; // thread belongs to another mailbox
      if (detection === 'error') {
        // Transient (or a 401/403 on this mailbox) — retried on the next rotation.
        console.warn(`[reply-check] Gmail error for interaction=${interaction.id} mailbox=${userId} — will retry`);
        return;
      }

      const patch = metaPatches.get(interaction.id);
      if (patch) {
        patch.sender_user_id = userId;
        patch.thread_id = threadId;
      }

      if (detection === 'none') return;

      const pair = `${interaction.cadence_id}:${interaction.lead_id}`;
      if (recordedPairs.has(pair)) return;
      recordedPairs.add(pair);

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
      return;
    }
  };

  // Parallel batches of 5 to stay under Gmail rate limits
  for (let i = 0; i < toCheck.length; i += PARALLEL_BATCH) {
    const results = await Promise.allSettled(toCheck.slice(i, i + PARALLEL_BATCH).map(inspect));
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[reply-check] Batch item failed:', r.reason);
      }
    }
  }

  // 4. Stamp the rotation (+ the mailbox that held the thread, when learned).
  // Merged inside the DB (metadata || patch): rewriting the whole JSON from here
  // would wipe opens/clicks that /api/track/* recorded during this run.
  const { error: stampError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>)('merge_interactions_metadata', {
    p_items: [...metaPatches].map(([id, patch]) => ({ id, patch })),
  });
  if (stampError) {
    // Without the stamp the rotation stalls on these same rows — make it loud.
    console.error('[reply-check] Failed to stamp reply_checked_at — rotation will not advance:', stampError.message);
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
  interaction: SentInteraction,
  accessToken: string,
): Promise<string | null> {
  // Check cached threadId in metadata
  const cachedThreadId = interaction.metadata?.thread_id as string | undefined;
  if (cachedThreadId) return cachedThreadId;

  // Fetch from Gmail API (404 when the message lives in another mailbox).
  // Persisted by the rotation stamp at the end of the run.
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${interaction.external_id}?fields=threadId`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { threadId?: string };
    return data.threadId ?? null;
  } catch {
    return null;
  }
}

/** Record a reply: create replied interaction + update enrollment status */
async function recordReply(
  supabase: SupabaseClient,
  sentInteraction: SentInteraction,
): Promise<void> {
  // Get org_id + owner + name from the lead (owner/name used for the SDR notification)
  const { data: lead } = (await from(supabase, 'leads')
    .select('org_id, assigned_to, nome_fantasia, razao_social, cnpj')
    .eq('id', sentInteraction.lead_id)
    .single()) as {
      data: {
        org_id: string;
        assigned_to: string | null;
        nome_fantasia: string | null;
        razao_social: string | null;
        cnpj: string | null;
      } | null;
    };

  if (!lead) return;

  // Create replied interaction. H2: inherit step_id + ab_variant from the
  // originating 'sent' so the A/B panel (which filters by step_id and buckets by
  // ab_variant) actually counts replies — previously step_id=null made them
  // invisible to fetchStepAbMetrics, so the chi-squared test never ran.
  const replyAbVariant = sentInteraction.metadata?.ab_variant;
  await from(supabase, 'interactions')
    .insert({
      org_id: lead.org_id,
      lead_id: sentInteraction.lead_id,
      cadence_id: sentInteraction.cadence_id,
      step_id: sentInteraction.step_id,
      channel: 'email',
      type: 'replied',
      message_content: null,
      metadata: {
        detected_by: 'gmail_thread_poll',
        sent_interaction_id: sentInteraction.id,
        ...(replyAbVariant ? { ab_variant: replyAbVariant } : {}),
      },
    } as Record<string, unknown>);

  // Mark ALL active enrollments of this lead as replied — when a lead engages
  // (responds an email), continuing to fire parallel cadences feels insistent
  // and burns reputation. Industry standard (Outreach, Salesloft, Meetime):
  // any reply stops all cadences for that lead. SDR can manually re-enroll
  // if desired.
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'replied', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('lead_id', sentInteraction.lead_id)
    .eq('status', 'active');

  dispatchWebhookEvent(supabase, lead.org_id, 'email.replied', {
    lead_id: sentInteraction.lead_id,
    cadence_id: sentInteraction.cadence_id,
    interaction_id: sentInteraction.id,
  });

  // Notify the SDR who owns the lead that it replied by email. This mirrors the
  // bounce path (recordBounce) — previously the reply was recorded and cadences
  // stopped, but the SDR was never told, so 'lead_replied' notifications never
  // fired. High-signal type: also chimes (see notification-sound allow-list).
  if (lead.assigned_to) {
    const leadName = lead.nome_fantasia || lead.razao_social || lead.cnpj || 'Lead';
    try {
      await createNotification({
        org_id: lead.org_id,
        user_id: lead.assigned_to,
        type: 'lead_replied',
        title: `Lead respondeu: ${leadName}`,
        body: 'Respondeu um email da sua cadência. Abra para ver e responder.',
        resource_type: 'lead',
        resource_id: sentInteraction.lead_id,
        metadata: {
          cadence_id: sentInteraction.cadence_id,
          detected_by: 'gmail_thread_poll',
          sent_interaction_id: sentInteraction.id,
        },
      });
    } catch (notifErr) {
      console.error(`[reply-check] Failed to notify reply for lead=${sentInteraction.lead_id}:`, notifErr);
    }
  }
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

  // 1. Create bounced interaction. H2: inherit step_id + ab_variant from the
  // originating 'sent' so A/B bounce metrics are attributed to the right step/variant
  // (previously step_id=null kept bounces out of fetchStepAbMetrics entirely).
  const bounceAbVariant = sentInteraction.metadata?.ab_variant;
  await from(supabase, 'interactions')
    .insert({
      org_id: lead.org_id,
      lead_id: sentInteraction.lead_id,
      cadence_id: sentInteraction.cadence_id,
      step_id: sentInteraction.step_id,
      channel: 'email',
      type: 'bounced',
      message_content: null,
      metadata: {
        detected_by: 'gmail_thread_poll',
        sent_interaction_id: sentInteraction.id,
        ...(bounceAbVariant ? { ab_variant: bounceAbVariant } : {}),
      },
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

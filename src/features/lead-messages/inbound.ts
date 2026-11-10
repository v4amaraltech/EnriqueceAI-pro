import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { isLeadMessagesCaptureEnabled } from './flag';
import { brPhoneVariants } from './phone-match';
import { recordLeadMessage, recordLeadMessageStatus, type LeadMessageMedia } from './record';

type Db = SupabaseClient;

export interface InboundMatch {
  leadId: string;
  leadContactId: string | null;
}

export async function matchLeadByContactPhone(db: Db, orgId: string, phone: string): Promise<
  | { kind: 'one'; match: InboundMatch }
  | { kind: 'none' }
  | { kind: 'ambiguous' }
> {
  const variants = brPhoneVariants(phone);
  if (variants.length === 0) return { kind: 'none' };
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ lead_id: string; lead_contact_id: string }> | null; error: { message: string } | null }>)(
    'match_lead_contacts_by_phone',
    { p_org_id: orgId, p_variants: variants },
  );
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  if (leadIds.length === 0) return { kind: 'none' };
  if (leadIds.length > 1) return { kind: 'ambiguous' };
  return {
    kind: 'one',
    match: { leadId: leadIds[0]!, leadContactId: rows[0]?.lead_contact_id ?? null },
  };
}

export async function quarantineLeadMessage(input: {
  orgId: string;
  channel: 'whatsapp' | 'email';
  provider: 'evolution' | 'meta' | 'gmail' | 'ana_n8n';
  connectionId?: string | null;
  ourAddress?: string | null;
  theirAddress?: string | null;
  bodyText?: string | null;
  media?: LeadMessageMedia | null;
  providerMessageId: string;
  occurredAt?: string | null;
  reason: 'no_lead' | 'ambiguous_lead';
}): Promise<void> {
  if (!input.providerMessageId.trim()) return;
  try {
    if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
    const db = createServiceRoleClient();
    const { error } = await from(db, 'lead_message_unmatched').upsert(
      {
        org_id: input.orgId,
        channel: input.channel,
        provider: input.provider,
        connection_id: input.connectionId ?? null,
        our_address: input.ourAddress ?? null,
        their_address: input.theirAddress ?? null,
        body_text: input.bodyText ?? null,
        media: input.media ? { type: input.media.type, provider_media_id: input.media.provider_media_id ?? null, mime: input.media.mime ?? null } : null,
        provider_message_id: input.providerMessageId.trim(),
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        reason: input.reason,
      } as Record<string, unknown>,
      { onConflict: 'org_id,provider,provider_message_id', ignoreDuplicates: true },
    );
    if (error) console.error('[lead-messages] quarentena falhou:', error.message);
  } catch (err) {
    console.error('[lead-messages] quarentena falhou:', err instanceof Error ? err.message : err);
  }
}

export async function storeOrQuarantine(input: {
  db: Db;
  orgId: string;
  channel: 'whatsapp' | 'email';
  provider: 'evolution' | 'meta' | 'gmail' | 'ana_n8n';
  phone: string;
  connectionId?: string | null;
  ourAddress?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  subject?: string | null;
  media?: LeadMessageMedia | null;
  providerMessageId: string;
  threadId?: string | null;
  rfcMessageId?: string | null;
  direction: 'inbound' | 'outbound';
  sentBy?: string | null;
  aiGenerated?: boolean;
  occurredAt?: string | null;
  status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
}): Promise<void> {
  if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
  const found = await matchLeadByContactPhone(input.db, input.orgId, input.phone);
  if (found.kind !== 'one') {
    await quarantineLeadMessage({
      orgId: input.orgId,
      channel: input.channel,
      provider: input.provider,
      connectionId: input.connectionId,
      ourAddress: input.ourAddress,
      theirAddress: input.phone,
      bodyText: input.bodyText,
      media: input.media,
      providerMessageId: input.providerMessageId,
      occurredAt: input.occurredAt,
      reason: found.kind === 'ambiguous' ? 'ambiguous_lead' : 'no_lead',
    });
    return;
  }
  await recordLeadMessage({
    orgId: input.orgId,
    leadId: found.match.leadId,
    leadContactId: found.match.leadContactId,
    channel: input.channel,
    direction: input.direction,
    provider: input.provider,
    connectionId: input.connectionId,
    ourAddress: input.ourAddress,
    leadAddress: input.phone,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    subject: input.subject,
    media: input.media,
    providerMessageId: input.providerMessageId,
    threadId: input.threadId,
    rfcMessageId: input.rfcMessageId,
    sentBy: input.sentBy,
    aiGenerated: input.aiGenerated,
    occurredAt: input.occurredAt ?? undefined,
    status: input.status,
  });
}

export async function appendStatusByProviderMessage(input: {
  orgId: string;
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt?: string;
  raw?: Record<string, unknown> | null;
}): Promise<void> {
  if (!input.providerMessageId.trim()) return;
  try {
    if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
    const db = createServiceRoleClient();
    const { data } = (await from(db, 'lead_messages')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('provider_message_id', input.providerMessageId)
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (!data) return;
    await recordLeadMessageStatus({
      orgId: input.orgId,
      messageId: data.id,
      status: input.status,
      occurredAt: input.occurredAt,
      raw: input.raw,
    });
  } catch (err) {
    console.error('[lead-messages] status falhou:', err instanceof Error ? err.message : err);
  }
}

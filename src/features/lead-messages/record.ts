import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { LEAD_MESSAGE_CHANNELS, LEAD_MESSAGE_DIRECTIONS, LEAD_MESSAGE_PROVIDERS, LEAD_MESSAGE_STATUSES } from './constants';
import { isInternalChannelLog } from './audience';
import { resolveLeadMessageBodyText } from './body-text';
import { isLeadMessagesCaptureEnabled } from './flag';

type Channel = (typeof LEAD_MESSAGE_CHANNELS)[number];
type Direction = (typeof LEAD_MESSAGE_DIRECTIONS)[number];
type Provider = (typeof LEAD_MESSAGE_PROVIDERS)[number];
type Status = (typeof LEAD_MESSAGE_STATUSES)[number];

export interface LeadMessageMedia {
  type: string;
  provider_media_id?: string | null;
  mime?: string | null;
}

export interface LeadMessageDraft {
  orgId: string;
  leadId: string;
  leadContactId?: string | null;
  channel: Channel;
  direction: Direction;
  provider: Provider;
  connectionId?: string | null;
  ourAddress?: string | null;
  leadAddress?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  subject?: string | null;
  media?: LeadMessageMedia | null;
  providerMessageId: string;
  threadId?: string | null;
  rfcMessageId?: string | null;
  sentBy?: string | null;
  aiGenerated?: boolean;
  occurredAt?: string;
  status?: Status | null;
}

/** Guarda só tipo, id do provedor e mime. Descarta URL, base64 e bytes. */
export function mediaMetadata(input: LeadMessageMedia | null | undefined): LeadMessageMedia | null {
  if (!input?.type?.trim()) return null;
  return {
    type: input.type.trim().slice(0, 40),
    provider_media_id: input.provider_media_id ? String(input.provider_media_id).slice(0, 200) : null,
    mime: input.mime ? String(input.mime).slice(0, 120) : null,
  };
}

/**
 * Grava a conversa quando a flag da org está ligada. Não lança: falha aqui
 * não muda o envio nem a linha em interactions. Idempotente pelo id do provedor.
 */
export async function recordLeadMessage(draft: LeadMessageDraft): Promise<void> {
  const providerMessageId = draft.providerMessageId.trim();
  if (!providerMessageId || !draft.leadId || !draft.orgId) return;
  // body_text sempre resolvido: texto do provedor ou HTML convertido. O HTML fica como veio.
  const bodyText = resolveLeadMessageBodyText({
    bodyText: draft.bodyText,
    bodyHtml: draft.bodyHtml,
    channel: draft.channel,
    direction: draft.direction,
  });
  if (isInternalChannelLog(null, bodyText) || isInternalChannelLog(null, draft.bodyHtml)) return;
  try {
    if (!(await isLeadMessagesCaptureEnabled(draft.orgId))) return;
    const db = createServiceRoleClient();
    const { data: prior } = (await from(db, 'lead_messages')
      .select('id')
      .eq('org_id', draft.orgId)
      .eq('channel', draft.channel)
      .eq('provider_message_id', providerMessageId)
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (prior) return;
    const occurredAt = draft.occurredAt ?? new Date().toISOString();
    const { error } = await from(db, 'lead_messages').upsert(
      {
        org_id: draft.orgId,
        lead_id: draft.leadId,
        lead_contact_id: draft.leadContactId ?? null,
        channel: draft.channel,
        direction: draft.direction,
        provider: draft.provider,
        connection_id: draft.connectionId ?? null,
        our_address: draft.ourAddress ?? null,
        lead_address: draft.leadAddress ?? null,
        body_text: bodyText,
        body_html: draft.bodyHtml ?? null,
        subject: draft.subject ?? null,
        media: mediaMetadata(draft.media),
        provider_message_id: providerMessageId,
        thread_id: draft.threadId ?? null,
        rfc_message_id: draft.rfcMessageId ?? null,
        sent_by: draft.sentBy ?? null,
        ai_generated: draft.aiGenerated === true,
        occurred_at: occurredAt,
      } as Record<string, unknown>,
      { onConflict: 'org_id,provider,provider_message_id', ignoreDuplicates: true },
    );
    if (error) {
      console.error('[lead-messages] captura falhou:', error.message);
      return;
    }
    if (!draft.status) return;
    const { data: row } = (await from(db, 'lead_messages')
      .select('id')
      .eq('org_id', draft.orgId)
      .eq('provider', draft.provider)
      .eq('provider_message_id', providerMessageId)
      .maybeSingle()) as { data: { id: string } | null };
    if (!row) return;
    await recordLeadMessageStatus({
      orgId: draft.orgId,
      messageId: row.id,
      status: draft.status,
      occurredAt,
    });
  } catch (err) {
    console.error('[lead-messages] captura falhou:', err instanceof Error ? err.message : err);
  }
}

export async function recordLeadMessageStatus(input: {
  orgId: string;
  messageId: string;
  status: Status;
  occurredAt?: string;
  raw?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
    const db = createServiceRoleClient();
    const { error } = await from(db, 'lead_message_status_events').upsert(
      {
        org_id: input.orgId,
        message_id: input.messageId,
        status: input.status,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        raw: input.raw ?? null,
      } as Record<string, unknown>,
      { onConflict: 'message_id,status', ignoreDuplicates: true },
    );
    if (error) console.error('[lead-messages] status falhou:', error.message);
  } catch (err) {
    console.error('[lead-messages] status falhou:', err instanceof Error ? err.message : err);
  }
}

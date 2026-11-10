import { isInternalChannelLog } from './audience';

export interface LegacyInteraction {
  id: string;
  org_id: string;
  lead_id: string;
  channel: string;
  type: string;
  message_content: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  ai_generated: boolean | null;
  performed_by: string | null;
  created_at: string;
}

export interface LegacyLeadMessage {
  org_id: string;
  lead_id: string;
  channel: 'whatsapp' | 'email';
  direction: 'inbound' | 'outbound';
  provider: 'legacy_interactions';
  body_text: string | null;
  body_html: string | null;
  subject: string | null;
  provider_message_id: string;
  thread_id: string | null;
  sent_by: string | null;
  ai_generated: boolean;
  occurred_at: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Copia uma interaction antiga. Retorna null quando não é conversa de WhatsApp ou e-mail. */
export function legacyInteractionToMessage(row: LegacyInteraction): LegacyLeadMessage | null {
  if (row.channel !== 'whatsapp' && row.channel !== 'email') return null;
  if (row.type === 'meeting_scheduled') return null;
  if (isInternalChannelLog(row.metadata, row.message_content)) return null;
  const inbound = row.type === 'replied';
  const outbound = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'].includes(row.type);
  if (!inbound && !outbound) return null;

  let status: LegacyLeadMessage['status'] = null;
  if (!inbound) {
    if (row.type === 'sent') status = 'sent';
    else if (row.type === 'delivered') status = 'delivered';
    else if (row.type === 'opened' && row.channel === 'whatsapp') status = 'read';
    else if (row.type === 'failed' || row.type === 'bounced') status = 'failed';
  }

  const externalId = row.external_id?.trim();
  return {
    org_id: row.org_id,
    lead_id: row.lead_id,
    channel: row.channel,
    direction: inbound ? 'inbound' : 'outbound',
    provider: 'legacy_interactions',
    body_text: row.message_content,
    body_html: text(row.metadata?.html_body),
    subject: text(row.metadata?.subject),
    provider_message_id: externalId || `interaction:${row.id}`,
    thread_id: text(row.metadata?.thread_id),
    sent_by: row.performed_by,
    ai_generated: row.ai_generated === true,
    occurred_at: row.created_at,
    status,
  };
}

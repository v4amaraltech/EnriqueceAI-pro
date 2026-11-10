import { locateGenuineReply } from '@/features/cadences/services/reply-detection.service';
import { plainText } from '@/features/lead-channel-chat/model';

import { isLeadMessagesCaptureEnabled } from './flag';
import { recordLeadMessage } from './record';

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

/** Texto da mensagem. Prefere text/plain. HTML vira texto, sem guardar o arquivo. */
export function gmailPartText(part: GmailPart | null | undefined): string {
  if (!part) return '';
  const own = part.body?.data ? decodeBase64Url(part.body.data) : '';
  if (part.mimeType === 'text/plain' && own.trim()) return own.trim();
  const nested = (part.parts ?? []).map((child) => gmailPartText(child)).find((text) => text.trim());
  if (nested) return nested;
  if (part.mimeType === 'text/html' && own.trim()) return plainText(own);
  return own.trim();
}

export async function captureGmailReply(input: {
  orgId: string;
  leadId: string;
  accessToken: string;
  threadId: string;
  sentMessageId: string;
  ourAddress?: string | null;
}): Promise<void> {
  try {
    if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
    const reply = await locateGenuineReply(input.threadId, input.accessToken, input.sentMessageId);
    if (!reply) return;
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${reply.messageId}?format=full`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    if (!response.ok) return;
    const data = (await response.json()) as { payload?: GmailPart };
    const text = gmailPartText(data.payload);
    await recordLeadMessage({
      orgId: input.orgId,
      leadId: input.leadId,
      channel: 'email',
      direction: 'inbound',
      provider: 'gmail',
      ourAddress: input.ourAddress ?? null,
      leadAddress: reply.from,
      bodyText: text || null,
      subject: reply.subject,
      providerMessageId: reply.messageId,
      threadId: input.threadId,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[lead-messages] resposta de e-mail não gravada:', err instanceof Error ? err.message : err);
  }
}

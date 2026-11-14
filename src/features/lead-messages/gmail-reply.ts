import { locateGenuineReply } from '@/features/cadences/services/reply-detection.service';

import { resolveLeadMessageBodyText } from './body-text';
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

/** Primeira parte text/plain e primeira text/html com conteúdo, em qualquer nível. */
export function gmailBodies(part: GmailPart | null | undefined): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;
  const walk = (node: GmailPart) => {
    const own = node.body?.data ? decodeBase64Url(node.body.data) : '';
    const mime = (node.mimeType ?? '').toLowerCase();
    if (mime === 'text/plain' && own.trim() && text === null) text = own;
    if (mime === 'text/html' && own.trim() && html === null) html = own;
    for (const child of node.parts ?? []) walk(child);
  };
  if (part) walk(part);
  return { text, html };
}

/** Texto da resposta do lead. Prefere text/plain. Só HTML vira texto. Corta citação e assinatura. */
export function gmailReplyText(part: GmailPart | null | undefined): string | null {
  const { text, html } = gmailBodies(part);
  return resolveLeadMessageBodyText({ bodyText: text, bodyHtml: html, channel: 'email', direction: 'inbound' });
}

export async function captureGmailReply(input: {
  orgId: string;
  leadId: string;
  accessToken: string;
  threadId: string;
  sentMessageId: string;
  ourAddress?: string | null;
  /** Id Gmail ja localizado pelo poll; evita buscar o fio de novo. */
  replyMessageId?: string | null;
}): Promise<void> {
  try {
    if (!(await isLeadMessagesCaptureEnabled(input.orgId))) return;
    const reply = input.replyMessageId
      ? { messageId: input.replyMessageId, from: null, subject: null }
      : await locateGenuineReply(input.threadId, input.accessToken, input.sentMessageId);
    if (!reply) return;
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${reply.messageId}?format=full`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );
    if (!response.ok) return;
    const data = (await response.json()) as { payload?: GmailPart };
    const { html } = gmailBodies(data.payload);
    const text = gmailReplyText(data.payload);
    await recordLeadMessage({
      orgId: input.orgId,
      leadId: input.leadId,
      channel: 'email',
      direction: 'inbound',
      provider: 'gmail',
      ourAddress: input.ourAddress ?? null,
      leadAddress: reply.from,
      bodyText: text,
      bodyHtml: html,
      subject: reply.subject,
      providerMessageId: reply.messageId,
      threadId: input.threadId,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[lead-messages] resposta de e-mail não gravada:', err instanceof Error ? err.message : err);
  }
}

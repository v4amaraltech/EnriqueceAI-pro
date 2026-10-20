// Pure pieces of the email reply-check cron (actions/check-email-replies.ts),
// kept out of the 'use server' module so they aren't exposed as Server Actions.

import { extractPlainText, stripQuotedReply } from '@/features/email-conversations/services/inbound-classifier';

/**
 * Whose Gmail may hold the thread, in the order to try.
 *
 * Since the engine started stamping `metadata.sender_user_id` this is exact.
 * Older rows only carry `performed_by` (the cadence creator), but the engine
 * sends from the lead owner's Gmail when it is connected — so for those we try
 * the owner first and fall back to the creator. Reading only `performed_by`
 * meant opening the wrong mailbox for ~60% of auto emails: the thread 404'd
 * and the reply was never detected.
 */
export function mailboxCandidates(
  interaction: { metadata: Record<string, unknown> | null; performed_by: string | null },
  leadOwner: string | null,
): string[] {
  const known = interaction.metadata?.sender_user_id;
  if (typeof known === 'string' && known) return [known];
  return [...new Set([leadOwner, interaction.performed_by].filter((v): v is string => !!v))];
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

export type ThreadOutcome = 'reply' | 'bounce' | 'none' | 'not_found' | 'error';

/** Cabeçalhos da PRIMEIRA resposta genuína do thread (só cabeçalhos: o poll não lê o corpo). */
export interface ThreadReplyDetails {
  messageId: string;
  from: string | null;
  subject: string | null;
  rfcMessageId: string | null;
  /** Cabeçalho Date da resposta, em ISO 8601; null se ausente/inválido. */
  date: string | null;
}

export interface ThreadInspection {
  outcome: ThreadOutcome;
  reply?: ThreadReplyDetails;
}

/**
 * Check if a Gmail thread contains a reply or a bounce.
 * 'not_found' = the thread isn't in this mailbox (try the next candidate);
 * 'error' = transient failure (leave it for the next rotation).
 */
export async function checkThreadForReplyOrBounce(threadId: string, accessToken: string): Promise<ThreadOutcome> {
  return (await inspectThread(threadId, accessToken)).outcome;
}

/**
 * Same check, but also returns the first genuine reply's headers (for the
 * BDR reply webhook). Reads `messages(id,payload(headers))` only — never the body.
 */
export async function inspectThread(threadId: string, accessToken: string): Promise<ThreadInspection> {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?fields=messages(id,payload(headers))`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (response.status === 404) return { outcome: 'not_found' };
    if (!response.ok) return { outcome: 'error' };

    const data = (await response.json()) as { messages?: GmailThreadMessage[] };
    const messages = data.messages ?? [];
    if (messages.length <= 1) return { outcome: 'none' };

    let hasGenuineReply = false;
    let reply: ThreadReplyDetails | undefined;

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
          return { outcome: 'bounce' };
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
      if (!reply && msg) {
        const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;
        const rawDate = header('date');
        const parsed = rawDate ? new Date(rawDate) : null;
        reply = {
          messageId: msg.id,
          from: fromHeader?.value ?? null,
          subject: subjectHeader?.value ?? null,
          rfcMessageId: header('message-id'),
          date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        };
      }
    }

    return hasGenuineReply ? { outcome: 'reply', reply } : { outcome: 'none' };
  } catch {
    return { outcome: 'error' };
  }
}

/**
 * Texto da resposta (sem HTML e sem o trecho citado), até `maxChars`. Uma
 * chamada extra ao Gmail, feita só quando o aviso do BDR IA vai sair; qualquer
 * falha devolve null — o aviso sai sem trecho.
 */
export async function fetchReplyText(messageId: string, accessToken: string, maxChars = 500): Promise<string | null> {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { payload?: unknown; snippet?: string };
    const text = stripQuotedReply(extractPlainText(data.payload as never)).trim() || (data.snippet ?? '').trim();
    return text ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

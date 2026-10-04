// Pure pieces of the email reply-check cron (actions/check-email-replies.ts),
// kept out of the 'use server' module so they aren't exposed as Server Actions.

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

/**
 * Check if a Gmail thread contains a reply or a bounce.
 * 'not_found' = the thread isn't in this mailbox (try the next candidate);
 * 'error' = transient failure (leave it for the next rotation).
 */
export async function checkThreadForReplyOrBounce(
  threadId: string,
  accessToken: string,
): Promise<'reply' | 'bounce' | 'none' | 'not_found' | 'error'> {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?fields=messages(id,payload(headers))`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (response.status === 404) return 'not_found';
    if (!response.ok) return 'error';

    const data = (await response.json()) as { messages?: GmailThreadMessage[] };
    const messages = data.messages ?? [];
    if (messages.length <= 1) return 'none';

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

    return hasGenuineReply ? 'reply' : 'none';
  } catch {
    return 'error';
  }
}

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

/** Precedence values that mark mailing-list or automatic mail, not a person. */
const AUTO_PRECEDENCE = new Set(['bulk', 'junk', 'list', 'auto_reply', 'autoreply']);

/** Value of a header by name (case-insensitive), or undefined. */
function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value;
}

/** Auto-resposta ou mala direta. `Auto-Submitted: no` não conta. */
function isAutomaticMail(headers: Array<{ name: string; value: string }> | undefined): boolean {
  const autoSubmitted = headerValue(headers, 'auto-submitted');
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') return true;
  if (headerValue(headers, 'x-autoreply')) return true;
  if (headerValue(headers, 'x-autorespond')) return true;
  const precedence = (headerValue(headers, 'precedence') ?? headerValue(headers, 'x-precedence') ?? '')
    .trim()
    .toLowerCase();
  return AUTO_PRECEDENCE.has(precedence);
}


function classifyThreadMessage(
  message: GmailThreadMessage | undefined,
  ourAddresses: Set<string>,
): 'bounce' | 'reply' | 'skip' {
  const headers = message?.payload?.headers ?? [];
  const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from');
  const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject');
  const fromAddress = extractAddress(fromHeader?.value);
  if (fromAddress && ourAddresses.has(fromAddress)) return 'skip';
  if (fromHeader && BOUNCE_SENDERS.some((sender) => fromHeader.value.toLowerCase().includes(sender))) return 'bounce';
  if (isAutomaticMail(headers)) return 'skip';
  if (subjectHeader && AUTO_REPLY_SUBJECTS.some((pattern) => subjectHeader.value.toLowerCase().includes(pattern))) {
    return 'skip';
  }
  return 'reply';
}

export interface GmailReplyLocator {
  messageId: string;
  from: string | null;
  subject: string | null;
}

/** Primeira resposta de verdade no fio, para gravar o texto. A detecção da cadência não usa isto. */
export async function locateGenuineReply(
  threadId: string,
  accessToken: string,
  sentMessageId?: string | null,
): Promise<GmailReplyLocator | null> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?fields=messages(id,payload(headers))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { messages?: GmailThreadMessage[] };
  const messages = data.messages ?? [];
  const ourAddresses = new Set<string>();
  const firstFrom = extractAddress(headerValue(messages[0]?.payload?.headers, 'from'));
  if (firstFrom) ourAddresses.add(firstFrom);
  const sentIndex = sentMessageId ? messages.findIndex((m) => m.id === sentMessageId) : -1;
  if (sentIndex >= 0) {
    const sentFrom = extractAddress(headerValue(messages[sentIndex]?.payload?.headers, 'from'));
    if (sentFrom) ourAddresses.add(sentFrom);
  }
  const start = sentIndex >= 0 ? sentIndex + 1 : 1;
  for (let i = start; i < messages.length; i++) {
    const message = messages[i];
    if (classifyThreadMessage(message, ourAddresses) !== 'reply' || !message?.id) continue;
    const headers = message.payload?.headers ?? [];
    return {
      messageId: message.id,
      from: extractAddress(headerValue(headers, 'from')),
      subject: headerValue(headers, 'subject') ?? null,
    };
  }
  return null;
}

/** "Nome <a@b.com>" → "a@b.com" (lower-case); null when there is no address. */
function extractAddress(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/<([^>]+)>/);
  const raw = (m?.[1] ?? value).trim().toLowerCase();
  return raw.includes('@') ? raw : null;
}

interface GmailThreadMessage {
  id: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

/**
 * Check if a Gmail thread contains a reply or a bounce to OUR message.
 * 'not_found' = the thread isn't in this mailbox (try the next candidate);
 * 'error' = transient failure (leave it for the next rotation).
 *
 * `sentMessageId` is the Gmail id of the message we sent (interactions.external_id).
 * When it is found in the thread, only the messages AFTER it count: a reply that
 * arrived before we wrote answers an earlier message, not this one. Without this,
 * the farewell the BDR e-mail agent sent on 26/10/2026 in the threads where Laza
 * and Falcare had already said "no" was re-recorded as a new reply on every
 * rotation (143 times each, plus an SDR notification each time).
 */
export type GmailThreadInspection =
  | { status: 'reply'; messageId: string }
  | { status: 'bounce' }
  | { status: 'none' }
  | { status: 'not_found' }
  | { status: 'error' };

export async function checkThreadForReplyOrBounce(
  threadId: string,
  accessToken: string,
  sentMessageId?: string | null,
): Promise<'reply' | 'bounce' | 'none' | 'not_found' | 'error'> {
  return (await inspectGmailThread(threadId, accessToken, sentMessageId)).status;
}

/**
 * Igual a `checkThreadForReplyOrBounce`, mas devolve o id Gmail da primeira
 * resposta genuína para gravar `external_id` e não repetir a mesma mensagem.
 */
export async function inspectGmailThread(
  threadId: string,
  accessToken: string,
  sentMessageId?: string | null,
): Promise<GmailThreadInspection> {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?fields=messages(id,payload(headers))`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'error' };

    const data = (await response.json()) as { messages?: GmailThreadMessage[] };
    const messages = data.messages ?? [];
    if (messages.length <= 1) return { status: 'none' };

    // The first message is ours (the cadence email). Later messages from the
    // same address are ours too: a follow-up step sent as "Re:" in the same
    // thread, or the SDR writing by hand. They are not a reply from the lead.
    // Without this, the BDR cadence's email 2 (sent in the thread of email 1)
    // was recorded as a reply 20 min later and stopped the lead's cadences
    // (23/10/2026: 7 leads of the Ana cadence, none had answered).
    const ourAddresses = new Set<string>();
    const firstFrom = extractAddress(headerValue(messages[0]?.payload?.headers, 'from'));
    if (firstFrom) ourAddresses.add(firstFrom);

    // Gmail returns the thread in chronological order. Start right after our
    // message when we can find it; otherwise after the first one (old rows).
    const sentIndex = sentMessageId ? messages.findIndex((m) => m.id === sentMessageId) : -1;
    if (sentIndex >= 0) {
      const sentFrom = extractAddress(headerValue(messages[sentIndex]?.payload?.headers, 'from'));
      if (sentFrom) ourAddresses.add(sentFrom);
    }
    const start = sentIndex >= 0 ? sentIndex + 1 : 1;

    let replyMessageId: string | undefined;

    // Check each message that came after ours
    for (let i = start; i < messages.length; i++) {
      const kind = classifyThreadMessage(messages[i], ourAddresses);
      if (kind === 'bounce') return { status: 'bounce' };
      const messageId = messages[i]?.id;
      if (kind === 'reply' && messageId && !replyMessageId) replyMessageId = messageId;
    }

    return replyMessageId ? { status: 'reply', messageId: replyMessageId } : { status: 'none' };
  } catch {
    return { status: 'error' };
  }
}

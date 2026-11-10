import { messageBody, plainText } from './body';
import { CHAT_COPY } from './constants';

export { plainText };

export type ChatChannel = 'whatsapp' | 'email';
export type ChatDirection = 'in' | 'out';

export interface ChatCursor {
  createdAt: string;
  id: string;
}

export interface ChatSourceRow {
  id: string;
  type: string;
  channel: ChatChannel;
  message_content: string | null;
  metadata: Record<string, unknown> | null;
  ai_generated: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  direction: ChatDirection;
  text: string;
  html: string | null;
  missingBody: boolean;
  createdAt: string;
  delivery: string | null;
  threadId: string | null;
  subject: string | null;
  aiGenerated: boolean;
}

export interface EmailThread {
  id: string;
  subject: string;
  messages: ChatMessage[];
}

const OUTBOUND = new Set(['sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed']);

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

export function deliveryLabel(channel: ChatChannel, type: string): string | null {
  if (type === 'sent') return CHAT_COPY.sent;
  if (type === 'delivered') return CHAT_COPY.delivered;
  if (type === 'opened') return channel === 'email' ? CHAT_COPY.openedEmail : CHAT_COPY.readWhatsapp;
  if (type === 'clicked') return CHAT_COPY.clicked;
  if (type === 'bounced') return CHAT_COPY.bounced;
  if (type === 'failed') return CHAT_COPY.failed;
  return null;
}

export function toChatMessage(row: ChatSourceRow): ChatMessage | null {
  if (row.type === 'meeting_scheduled') return null;
  if (row.metadata && typeof row.metadata.system_event === 'string') return null;
  const inbound = row.type === 'replied';
  if (!inbound && !OUTBOUND.has(row.type)) return null;

  const threadRaw = row.metadata?.thread_id;
  const subjectRaw = row.metadata?.subject;
  const threadId = typeof threadRaw === 'string' && threadRaw.trim() ? threadRaw.trim() : null;
  const subject = typeof subjectRaw === 'string' && subjectRaw.trim() ? subjectRaw.trim() : null;
  const htmlBody = typeof row.metadata?.html_body === 'string' ? row.metadata.html_body : null;
  const body = messageBody({ html: htmlBody, text: row.message_content });
  const missingBody = body.text.length === 0;
  const note = row.metadata?.is_note === true;
  const text = missingBody
    ? (inbound ? CHAT_COPY.missingReply : CHAT_COPY.missingOutbound)
    : note
      ? `${CHAT_COPY.note}: ${body.text}`
      : body.text;

  return {
    id: row.id,
    channel: row.channel,
    direction: inbound ? 'in' : 'out',
    text,
    html: missingBody || note ? null : body.html,
    missingBody,
    createdAt: row.created_at,
    delivery: inbound ? null : deliveryLabel(row.channel, row.type),
    threadId,
    subject,
    aiGenerated: row.ai_generated === true,
  };
}

const MEDIA_COPY: Record<string, string> = {
  image: CHAT_COPY.mediaImage,
  audio: CHAT_COPY.mediaAudio,
  video: CHAT_COPY.mediaVideo,
  document: CHAT_COPY.mediaDocument,
  sticker: CHAT_COPY.mediaSticker,
};

export interface StoredLeadMessage {
  id: string;
  channel: ChatChannel;
  direction: 'inbound' | 'outbound';
  body_text: string | null;
  body_html: string | null;
  subject: string | null;
  media: { type?: string } | null;
  thread_id: string | null;
  ai_generated: boolean;
  occurred_at: string;
}

export function statusTick(channel: ChatChannel, status: string | null): string | null {
  if (status === 'sent') return `✓ ${CHAT_COPY.sent}`;
  if (status === 'delivered') return `✓✓ ${CHAT_COPY.delivered}`;
  if (status === 'read') return `✓✓ ${channel === 'email' ? CHAT_COPY.openedEmail : CHAT_COPY.readWhatsapp}`;
  if (status === 'failed') return CHAT_COPY.failed;
  return null;
}

export function storedLeadMessageToChat(row: StoredLeadMessage, status: string | null): ChatMessage {
  const inbound = row.direction === 'inbound';
  const body = plainText(row.body_text) || plainText(row.body_html);
  const mediaLabel = row.media?.type ? (MEDIA_COPY[row.media.type] ?? CHAT_COPY.mediaOther) : null;
  const missingBody = body.length === 0 && !mediaLabel;
  const text = body
    ? (mediaLabel ? `${body}\n${mediaLabel}` : body)
    : (mediaLabel ?? (inbound ? CHAT_COPY.missingReply : CHAT_COPY.missingOutbound));
  return {
    id: row.id,
    channel: row.channel,
    direction: inbound ? 'in' : 'out',
    text,
    missingBody,
    createdAt: row.occurred_at,
    delivery: inbound ? null : statusTick(row.channel, status),
    threadId: row.thread_id,
    subject: row.subject,
    aiGenerated: row.ai_generated === true,
  };
}

export function chronological(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function mergeOlder(current: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...older, ...current]) byId.set(message.id, message);
  return chronological([...byId.values()]);
}

export function formatChatDay(iso: string): string {
  return dayFormat.format(new Date(iso));
}

export function formatChatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export interface DayGroup {
  label: string;
  messages: ChatMessage[];
}

export function groupByDay(messages: ChatMessage[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of chronological(messages)) {
    const label = formatChatDay(message.createdAt);
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) groups.push({ label, messages: [message] });
    else last.messages.push(message);
  }
  return groups;
}

export function groupEmailThreads(messages: ChatMessage[]): EmailThread[] {
  const buckets = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const key = message.threadId ?? `avulsa:${message.id}`;
    const list = buckets.get(key);
    if (list) list.push(message);
    else buckets.set(key, [message]);
  }
  return [...buckets.entries()]
    .map(([id, items]) => {
      const ordered = chronological(items);
      const subject = ordered.find((item) => item.subject)?.subject
        ?? (id.startsWith('avulsa:') ? CHAT_COPY.unthreaded : CHAT_COPY.noSubject);
      return { id, subject, messages: ordered };
    })
    .sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.createdAt ?? '';
      const bLast = b.messages[b.messages.length - 1]?.createdAt ?? '';
      return bLast.localeCompare(aLast);
    });
}

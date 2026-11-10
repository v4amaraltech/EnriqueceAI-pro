import type { LeadMessageMedia } from './record';

export interface ParsedEvolutionMessage {
  messageId: string;
  remoteJid: string;
  phone: string;
  direction: 'inbound' | 'outbound';
  text: string;
  media: LeadMessageMedia | null;
  occurredAt: string | null;
  skip: 'group' | 'broadcast' | null;
}

const MEDIA_KEYS: Array<{ key: string; type: string }> = [
  { key: 'imageMessage', type: 'image' },
  { key: 'videoMessage', type: 'video' },
  { key: 'audioMessage', type: 'audio' },
  { key: 'documentMessage', type: 'document' },
  { key: 'stickerMessage', type: 'sticker' },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function firstMessage(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return asRecord(data[0]);
  const record = asRecord(data);
  if (!record) return null;
  if (Array.isArray(record.messages)) return asRecord(record.messages[0]);
  return record;
}

function mediaOf(message: Record<string, unknown>, messageId: string): { text: string; media: LeadMessageMedia | null } {
  for (const item of MEDIA_KEYS) {
    const media = asRecord(message[item.key]);
    if (!media) continue;
    const caption = typeof media.caption === 'string' ? media.caption : '';
    const mime = typeof media.mimetype === 'string' ? media.mimetype : null;
    return {
      text: caption,
      media: { type: item.type, provider_media_id: messageId, mime },
    };
  }
  const text = typeof message.conversation === 'string'
    ? message.conversation
    : typeof asRecord(message.extendedTextMessage)?.text === 'string'
      ? String(asRecord(message.extendedTextMessage)?.text)
      : '';
  return { text, media: null };
}

/** Lê uma mensagem do messages.upsert. Grupo e status não viram conversa. */
export function parseEvolutionUpsert(data: unknown, occurredAt: string | null): ParsedEvolutionMessage | null {
  const msg = firstMessage(data);
  const key = asRecord(msg?.key);
  if (!msg || !key) return null;
  const messageId = typeof key.id === 'string' ? key.id.trim() : '';
  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  if (!messageId || !remoteJid) return null;
  const skip = remoteJid.endsWith('@g.us') ? 'group' : remoteJid.includes('broadcast') ? 'broadcast' : null;
  const phone = (remoteJid.split('@')[0] ?? '').split(':')[0]?.replace(/\D/g, '') ?? '';
  const message = asRecord(msg.message) ?? {};
  const content = mediaOf(message, messageId);
  const stamp = typeof msg.messageTimestamp === 'number'
    ? new Date(msg.messageTimestamp * 1000).toISOString()
    : occurredAt;
  return {
    messageId,
    remoteJid,
    phone,
    direction: key.fromMe === true ? 'outbound' : 'inbound',
    text: content.text,
    media: content.media,
    occurredAt: stamp,
    skip,
  };
}

// Pure helpers for the Evolution webhook — no Deno/remote imports, so they can
// be unit-tested with Vitest (tests/edge/evolution-events.test.ts).

const MESSAGE_EVENTS = new Set(['messages.upsert', 'MESSAGES_UPSERT', 'messages.update', 'MESSAGES_UPDATE']);

/** WhatsApp message types that are not a reply from the lead. */
const NON_REPLY_MESSAGE_KEYS = ['reactionMessage', 'protocolMessage', 'editedMessage', 'pollUpdateMessage'];

export function isMessageEvent(event: string): boolean {
  return MESSAGE_EVENTS.has(event);
}

/** First message object of an Evolution `data` payload (object, array or {messages}). */
function firstMessage(data: unknown): Record<string, any> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const container = data as Record<string, unknown>;
  const raw = Array.isArray(data)
    ? data[0]
    : Array.isArray(container.messages)
      ? (container.messages as unknown[])[0]
      : data;
  return raw as Record<string, any> | undefined;
}

/**
 * Idempotency key for a webhook delivery. Message events use the WhatsApp
 * message id (`key.id`): the old `instance_event_date_time` key made two
 * different messages delivered in the same millisecond collide, and the second
 * was dropped as a "duplicate". `messages.update` also carries the status
 * (delivered/read) so successive updates of one message stay distinct.
 */
export function buildEvolutionEventId(instanceName: string, event: string, payload: Record<string, any>): string {
  if (isMessageEvent(event)) {
    const msg = firstMessage(payload?.data);
    const keyId = msg?.key?.id ?? msg?.keyId;
    if (keyId) {
      const status = msg?.status ?? msg?.update?.status;
      return [instanceName, event, String(keyId), status ? String(status) : null].filter(Boolean).join('_');
    }
  }
  return `${instanceName}_${event}_${payload?.date_time || Date.now()}`;
}

export interface InboundReply {
  phone: string;
  text: string;
  messageId: string;
  pushName: string | null;
}

/**
 * Normalize an Evolution `messages.upsert` `data` payload into an inbound reply,
 * or null when it must be ignored: our own outbound (fromMe), groups, status
 * broadcasts, or a payload without a message key.
 */
export function parseInboundMessage(data: unknown): InboundReply | null {
  const msg = firstMessage(data);
  const key = msg?.key;
  if (!key) return null;
  if (key.fromMe === true) return null; // our own outbound
  const jid = String(key.remoteJid ?? '');
  if (!jid) return null;
  if (jid.endsWith('@g.us') || jid.includes('broadcast')) return null; // group / status
  const phone = (jid.split('@')[0] ?? '').split(':')[0]?.replace(/\D/g, '') ?? '';
  if (!phone) return null;
  const m = (msg?.message ?? {}) as Record<string, any>;
  // Not a reply from the lead: reactions, deletes/edits (protocolMessage),
  // edited messages and poll votes would otherwise stop the cadence.
  if (NON_REPLY_MESSAGE_KEYS.some((k) => k in m)) return null;
  const text = String(
    m.conversation ??
      m.extendedTextMessage?.text ??
      m.ephemeralMessage?.message?.conversation ??
      m.ephemeralMessage?.message?.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.videoMessage?.caption ??
      m.documentMessage?.caption ??
      '',
  );
  return { phone, text, messageId: String(key.id ?? ''), pushName: (msg?.pushName as string) ?? null };
}

/**
 * Phone strings to match against leads.telefone, covering the Brazilian country
 * code (55) and 9th-digit variance both ways (leads may be stored either form).
 */
export function phoneCandidates(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const set = new Set<string>();
  const add = (p: string) => {
    if (p) {
      set.add(p);
      set.add('+' + p);
    }
  };
  add(digits);

  // Strip the 55 country code to get the local DDD + number.
  let local = digits;
  if (digits.startsWith('55') && digits.length >= 12) {
    local = digits.slice(2);
    add(local);
    add('55' + local);
  }

  // local = DDD(2) + number(8 or 9 digits) — toggle the 9th digit both ways.
  if (local.length === 11 && local[2] === '9') {
    const without = local.slice(0, 2) + local.slice(3);
    add(without);
    add('55' + without);
  } else if (local.length === 10) {
    const withNine = local.slice(0, 2) + '9' + local.slice(2);
    add(withNine);
    add('55' + withNine);
  }

  return [...set];
}

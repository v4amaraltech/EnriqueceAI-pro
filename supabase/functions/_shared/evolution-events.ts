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
 * Local forms (DDD + number, digits only) of an inbound WhatsApp number, to
 * look the lead up by digits (`find_lead_ids_by_phone`): the number as sent and
 * the 9th-digit variant — WhatsApp sometimes sends mobiles without the 9, and
 * leads may be stored either way. The 9 is only added to mobiles (number starts
 * with 6–9); landlines stay as they are. Returns [] when it isn't a BR number
 * with DDD (10 or 11 local digits) — foreign numbers and WhatsApp `@lid` ids
 * (~15 digits) would otherwise match a random lead by their last digits.
 */
export function localPhoneVariants(phone: string): string[] {
  const local = toLocalDigits(phone);
  if (local.length === 11) {
    return local[2] === '9' ? [local, local.slice(0, 2) + local.slice(3)] : [local];
  }
  if (local.length === 10) {
    return /[6-9]/.test(local[2] ?? '') ? [local, local.slice(0, 2) + '9' + local.slice(2)] : [local];
  }
  return [];
}

/** Digits only, without the 55 country code. */
function toLocalDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

/**
 * Does any of the lead's numbers (telefone + phones[].numero) EQUAL one of the
 * variants? `find_lead_ids_by_phone` also compares the last 10 digits of an
 * 11-digit number, which drops the 1st DDD digit — "(51) 99999-8888" would match
 * "11 99999-8888". This exact check closes that gap (0 such pairs in prod on
 * 04/10, but a hit would stop the wrong lead's cadence).
 */
export function leadPhoneMatches(telefone: string | null, phones: unknown, variants: readonly string[]): boolean {
  const wanted = new Set(variants);
  const numbers: string[] = [];
  if (telefone) numbers.push(telefone);
  if (Array.isArray(phones)) {
    for (const p of phones) {
      if (typeof p === 'string') numbers.push(p);
      else if (p && typeof p === 'object') {
        const n = (p as Record<string, unknown>).numero ?? (p as Record<string, unknown>).number;
        if (typeof n === 'string') numbers.push(n);
      }
    }
  }
  return numbers.some((n) => wanted.has(toLocalDigits(n)));
}

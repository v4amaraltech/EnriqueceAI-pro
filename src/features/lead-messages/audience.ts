import { brPhoneVariants, phoneDigits } from './phone-match';

const INTERNAL_KINDS = new Set([
  'closer',
  'manager',
  'gestor',
  'sdr',
  'user',
  'usuario',
  'internal',
  'profile',
]);

const ADDRESS_KEYS = ['recipient', 'to', 'phone', 'lead_phone', 'destination', 'lead_address'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Aviso interno (closer, gestor, SDR), não conversa com o lead. */
export function isInternalChannelLog(
  metadata: Record<string, unknown> | null | undefined,
  content: string | null | undefined,
): boolean {
  if (text(metadata?.system_event)) return true;
  const kind = text(metadata?.recipient_kind)?.toLowerCase();
  if (kind && INTERNAL_KINDS.has(kind)) return true;
  const source = text(metadata?.source)?.toLowerCase();
  if (source === 'closer_feedback' || source?.startsWith('closer_feedback')) return true;
  if (source === 'activity_reminder' || source === 'meeting_outcome_check') return true;
  const body = content?.trim() ?? '';
  return /^(WhatsApp|E-mail|Email) de solicitação de feedback (enviado|falhou) para /i.test(body);
}

export function listedAddresses(
  metadata: Record<string, unknown> | null | undefined,
  explicitAddress?: string | null,
): string[] {
  const found: string[] = [];
  const explicit = text(explicitAddress);
  if (explicit) found.push(explicit);
  for (const key of ADDRESS_KEYS) {
    const value = text(metadata?.[key]);
    if (value) found.push(value);
  }
  return found;
}

function phoneHitsLead(phone: string, leadPhones: string[]): boolean {
  const variants = new Set(leadPhones.flatMap((item) => brPhoneVariants(item)));
  if (variants.size === 0) return false;
  return brPhoneVariants(phone).some((variant) => variants.has(variant));
}

export interface ConversationCheck {
  channel: 'whatsapp' | 'email';
  metadata?: Record<string, unknown> | null;
  content?: string | null;
  explicitAddress?: string | null;
  leadPhones: string[];
  leadEmails: string[];
  /** false quando a leitura dos telefones do lead falhou: não descarta por número. */
  phonesKnown: boolean;
  emailsKnown: boolean;
}

/**
 * Conversa do pré-vendas com o lead.
 * Notificação interna sai sempre.
 * Se houver telefone ou e-mail de destino, ele precisa ser do lead.
 * Linha antiga sem destino continua, porque a cadência grava o texto e não o número.
 */
export function isLeadConversation(input: ConversationCheck): boolean {
  if (isInternalChannelLog(input.metadata, input.content)) return false;
  const addresses = listedAddresses(input.metadata, input.explicitAddress);
  if (input.channel === 'whatsapp') {
    const phones = addresses.map((item) => phoneDigits(item)).filter((digits) => digits.length >= 10);
    if (phones.length === 0 || !input.phonesKnown) return true;
    return phones.some((phone) => phoneHitsLead(phone, input.leadPhones));
  }
  const emails = addresses
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.includes('@'));
  if (emails.length === 0 || !input.emailsKnown) return true;
  const allowed = new Set(input.leadEmails.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return emails.some((email) => allowed.has(email));
}

/**
 * BDR-3 — Regras puras de classificação de mensagens recebidas na caixa do BDR IA.
 * Sem I/O: testáveis sem Gmail nem banco.
 */

/**
 * calendar  = convite/aceite/recusa de agenda (Google Agenda, Outlook): nunca vira conversa.
 * unrelated = e-mail de lead que NÃO continua um thread iniciado pela cadência do BDR IA:
 *             fica em `email_inbound` para auditoria, sem conversa e sem `replied`.
 */
export type InboundKind = 'lead' | 'own' | 'auto_reply' | 'bounce' | 'calendar' | 'unrelated' | 'unknown';

const BOUNCE_SENDERS = ['mailer-daemon', 'postmaster', 'mail delivery', 'delivery status', 'no-reply@accounts.google.com'];
const AUTO_REPLY_SUBJECTS = [
  'automatic reply', 'auto-reply', 'autoreply', 'out of office', 'resposta automática',
  'resposta automatica', 'ausência', 'ausencia', 'fora do escritório', 'fora do escritorio',
  'férias', 'ferias', 'estou ausente', 'auto: ',
];
const AUTO_REPLY_HEADERS = ['x-autoreply', 'x-autorespond', 'auto-submitted', 'x-auto-response-suppress'];

const CALENDAR_MIME = ['text/calendar', 'application/ics'];
const CALENDAR_SENDERS = ['calendar-notification@google.com'];
const CALENDAR_VIA = ['via google agenda', 'via google calendar'];
const CALENDAR_SUBJECT_PREFIXES = [
  'convite:', 'convite atualizado:', 'aceitar:', 'aceito:', 'recusado:', 'talvez:',
  'invitation:', 'updated invitation:', 'accepted:', 'declined:', 'decline:', 'tentative:',
];
/** "V4 Company + X - qua. 14 out. 2026 3pm" — dia da semana. dia mês. ano (Google Agenda em pt-BR). */
const CALENDAR_SUBJECT_DATE = /\s-\s(?:dom|seg|ter|qua|qui|sex|s[áa]b)\.\s\d{1,2}\s(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s\d{4}/i;
const REPLY_PREFIX = /^((re|res|fw|fwd|enc)\s*:\s*)+/i;

export interface InboundHeaders {
  [name: string]: string | undefined;
}

/** Extrai o endereço de um cabeçalho From/To ("Nome <a@b.com>" → "a@b.com"). */
export function extractEmailAddress(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = value.match(/<([^>]+)>/);
  const raw = (m?.[1] ?? value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

/** Cabeçalhos do Gmail (array {name,value}) → mapa com nomes em minúsculas. */
export function headersToMap(headers: Array<{ name?: string; value?: string }> | undefined): InboundHeaders {
  const map: InboundHeaders = {};
  for (const h of headers ?? []) {
    if (!h.name) continue;
    map[h.name.toLowerCase()] = h.value ?? '';
  }
  return map;
}

/**
 * Classifica a mensagem. `ownEmails` = endereços das caixas do BDR (a própria e as irmãs);
 * `ownDomains` = domínios da casa. `isKnownLeadSender` = já existe conversa nesta thread.
 * Ordem: own → bounce → calendar → auto_reply → lead. `unrelated` NÃO sai daqui: é o
 * ingestor que rebaixa `lead` para `unrelated` quando a thread não é nossa (ver matchesOurThread).
 */
export function classifyInbound({
  headers,
  ownEmails,
  ownDomains = [],
  isKnownLeadSender = false,
  mimeType,
  partMimeTypes,
  attachmentNames,
}: {
  headers: InboundHeaders;
  ownEmails: string[];
  /** Domínios da casa (v4company.com, v4companyamaral.com…): remetente daí é `own`, nunca lead. */
  ownDomains?: string[];
  isKnownLeadSender?: boolean;
  mimeType?: string | null;
  /** MIME de todas as partes da mensagem (inclui a raiz). */
  partMimeTypes?: string[];
  /** Nomes de arquivo das partes (anexos). */
  attachmentNames?: string[];
}): InboundKind {
  const from = extractEmailAddress(headers['from']) ?? '';
  const subject = (headers['subject'] ?? '').toLowerCase();

  if (from && ownEmails.map((e) => e.toLowerCase()).includes(from)) return 'own';
  const fromDomain = from.split('@')[1] ?? '';
  if (fromDomain && ownDomains.map((d) => d.toLowerCase()).includes(fromDomain)) return 'own';

  if (BOUNCE_SENDERS.some((s) => from.includes(s)) || (mimeType ?? '').toLowerCase().startsWith('multipart/report')) {
    return 'bounce';
  }

  if (isCalendarMessage({ headers, mimeType, partMimeTypes, attachmentNames })) return 'calendar';

  const autoSubmitted = (headers['auto-submitted'] ?? '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto_reply';
  if (AUTO_REPLY_HEADERS.some((h) => h !== 'auto-submitted' && headers[h] != null)) return 'auto_reply';
  if (AUTO_REPLY_SUBJECTS.some((s) => subject.includes(s))) return 'auto_reply';
  if ((headers['precedence'] ?? '').toLowerCase() === 'bulk' && !isKnownLeadSender) return 'auto_reply';

  if (!from) return 'unknown';
  return 'lead';
}

/**
 * Convite/resposta de agenda? Qualquer um destes sinais basta: parte MIME
 * text/calendar ou anexo .ics; Content-Class de calendário (Outlook/Exchange);
 * remetente do Google Agenda; assunto no padrão de convite/aceite/recusa ou
 * com a data do Google ("- qua. 14 out. 2026").
 */
export function isCalendarMessage({
  headers,
  mimeType,
  partMimeTypes = [],
  attachmentNames = [],
}: {
  headers: InboundHeaders;
  mimeType?: string | null;
  partMimeTypes?: string[];
  attachmentNames?: string[];
}): boolean {
  const mimes = [mimeType ?? '', ...partMimeTypes].map((m) => m.toLowerCase().split(';')[0]?.trim() ?? '');
  if (mimes.some((m) => CALENDAR_MIME.includes(m))) return true;
  if (attachmentNames.some((n) => n.toLowerCase().trim().endsWith('.ics'))) return true;

  if ((headers['content-class'] ?? '').toLowerCase().includes('urn:content-classes:calendarmessage')) return true;

  const fromRaw = (headers['from'] ?? '').toLowerCase();
  const from = extractEmailAddress(headers['from']) ?? '';
  if (CALENDAR_SENDERS.includes(from) || CALENDAR_VIA.some((v) => fromRaw.includes(v))) return true;

  // "Re: Convite: ..." continua sendo tráfego de agenda
  const subject = (headers['subject'] ?? '').trim().toLowerCase().replace(REPLY_PREFIX, '');
  if (CALENDAR_SUBJECT_PREFIXES.some((p) => subject.startsWith(p))) return true;
  if (CALENDAR_SUBJECT_DATE.test(subject)) return true;

  return false;
}

/** Message-IDs referenciados por In-Reply-To e References (com os <>). */
export function extractReferencedMessageIds(headers: InboundHeaders): string[] {
  const raw = `${headers['in-reply-to'] ?? ''} ${headers['references'] ?? ''}`;
  return [...new Set(raw.match(/<[^<>\s]+>/g) ?? [])];
}

/** Um envio nosso: e-mail de cadência do BDR IA ou resposta do agente. */
export interface OurSend {
  thread_id?: string | null;
  rfc_message_id?: string | null;
}

/**
 * A mensagem continua um thread que NÓS começamos? Casa pelo `threadId` do
 * Gmail igual ao `metadata.thread_id` de um envio, OU por In-Reply-To /
 * References contendo o `rfc_message_id` de um envio. Sem casamento, não é
 * conversa de lead (é e-mail avulso).
 */
export function matchesOurThread(
  { threadId, headers }: { threadId: string | null | undefined; headers: InboundHeaders },
  sends: OurSend[],
): boolean {
  if (!sends.length) return false;
  if (threadId && sends.some((s) => !!s.thread_id && s.thread_id === threadId)) return true;
  const refs = new Set(extractReferencedMessageIds(headers).map((r) => r.toLowerCase()));
  if (!refs.size) return false;
  return sends.some((s) => !!s.rfc_message_id && refs.has(s.rfc_message_id.trim().toLowerCase()));
}

/** base64url (Gmail) → texto UTF-8. */
export function decodeBase64Url(data: string | undefined | null): string {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

/** MIME de todas as partes (raiz incluída) e nomes dos anexos. */
export function collectMimeParts(payload: GmailPart | undefined): { mimeTypes: string[]; attachmentNames: string[] } {
  const mimeTypes: string[] = [];
  const attachmentNames: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.mimeType) mimeTypes.push(p.mimeType.toLowerCase());
    if (p.filename) attachmentNames.push(p.filename);
    for (const c of p.parts ?? []) walk(c);
  };
  if (payload) walk(payload);
  return { mimeTypes, attachmentNames };
}

/** Texto puro da mensagem: prefere text/plain; cai para text/html sem tags. */
export function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    const mt = (p.mimeType ?? '').toLowerCase();
    if (mt === 'text/plain' && p.body?.data) plain.push(decodeBase64Url(p.body.data));
    else if (mt === 'text/html' && p.body?.data) html.push(decodeBase64Url(p.body.data));
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  if (plain.length) return plain.join('\n').trim();
  if (html.length) {
    return html
      .join('\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return '';
}

/** Remove o texto citado da resposta (linhas "> " e blocos "Em ... escreveu:"). */
export function stripQuotedReply(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^(em|on) .{6,120} (escreveu|wrote):\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*(original message|mensagem original)/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

export type GmailSendOutcome = 'enviada' | 'falhou' | 'incerta';

/**
 * Classifica o resultado do envio pelo código, motivo e estágio — nunca só
 * pela classe HTTP. 5xx e timeout = a mensagem PODE ter saído (incerta).
 */
export function classifyGmailSendResult(r: {
  success: boolean;
  httpStatus?: number | null;
  stage?: 'request' | 'response' | 'network' | null;
  error?: string | null;
}): GmailSendOutcome {
  if (r.success) return 'enviada';
  if (r.stage === 'network') return 'incerta';
  const st = r.httpStatus ?? null;
  if (st != null && [400, 401, 403, 404, 413, 422, 429].includes(st) && r.stage === 'response') return 'falhou';
  if (st != null && st >= 500) return 'incerta';
  return 'incerta';
}

export type SenderAuth = 'pass' | 'fail' | 'unknown';

/**
 * The Authentication-Results header Gmail itself added — the FIRST one whose
 * authserv-id is mx.google.com (Gmail prepends its own on top). Lower ones can
 * be forged by the sender, so later occurrences are ignored.
 */
export function gmailAuthenticationResults(headers: Array<{ name?: string; value?: string }> | undefined): string | null {
  for (const h of headers ?? []) {
    if (h.name?.toLowerCase() !== 'authentication-results') continue;
    const v = (h.value ?? '').trim();
    if (v.toLowerCase().startsWith('mx.google.com')) return v;
  }
  return null;
}

/** Same domain, or one is a subdomain of the other (relaxed alignment). */
function domainsAligned(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Was the From domain authenticated? DMARC decides when present (it already
 * checks alignment). Without DMARC (common on small company domains), an SPF
 * or DKIM pass only counts when it is for the From domain itself — otherwise a
 * sender passes SPF/DKIM for their OWN domain and just forges the visible From.
 * No Gmail header → 'unknown'.
 */
export function senderAuthVerdict(authResults: string | null, fromEmail?: string | null): SenderAuth {
  if (!authResults) return 'unknown';
  // Strip quoted strings and (comments) before splitting on ';': Gmail echoes
  // the sender-controlled envelope address inside the SPF comment, so a
  // MAIL FROM like `"x;dmarc=pass"@evil.com` would otherwise inject an entry.
  const cleaned = authResults
    .toLowerCase()
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\([^)]*\)/g, '');
  const entries = cleaned.split(';').map((e) => e.trim());
  const results = (mech: string) => entries.filter((e) => e.startsWith(`${mech}=`));

  const fromDomain = fromEmail?.split('@')[1]?.toLowerCase();
  // DMARC only speaks for the From domain it evaluated (header.from).
  const dmarcEntry = results('dmarc').find((e) => {
    const d = e.match(/header\.from=([a-z0-9.-]+)/)?.[1];
    return !fromDomain || !d || d === fromDomain;
  });
  const dmarc = dmarcEntry?.match(/^dmarc=([a-z]+)/)?.[1] ?? null;
  if (dmarc === 'pass') return fromDomain ? 'pass' : 'fail';
  if (dmarc === 'fail') return 'fail';

  if (!fromDomain) return 'fail';
  const spfOk = results('spf').some((e) => {
    if (!/^spf=pass\b/.test(e)) return false;
    const d = e.match(/smtp\.mailfrom=(?:[^@\s;]*@)?([a-z0-9.-]+)/)?.[1];
    return !!d && domainsAligned(d, fromDomain);
  });
  const dkimOk = results('dkim').some((e) => {
    if (!/^dkim=pass\b/.test(e)) return false;
    const d = e.match(/header\.d=([a-z0-9.-]+)/)?.[1] ?? e.match(/header\.i=[^@\s;]*@([a-z0-9.-]+)/)?.[1];
    return !!d && domainsAligned(d, fromDomain);
  });
  return spfOk || dkimOk ? 'pass' : 'fail';
}

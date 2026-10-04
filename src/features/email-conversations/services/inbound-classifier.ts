/**
 * BDR-3 — Regras puras de classificação de mensagens recebidas na caixa do BDR IA.
 * Sem I/O: testáveis sem Gmail nem banco.
 */

export type InboundKind = 'lead' | 'own' | 'auto_reply' | 'bounce' | 'unknown';

const BOUNCE_SENDERS = ['mailer-daemon', 'postmaster', 'mail delivery', 'delivery status', 'no-reply@accounts.google.com'];
const AUTO_REPLY_SUBJECTS = [
  'automatic reply', 'auto-reply', 'autoreply', 'out of office', 'resposta automática',
  'resposta automatica', 'ausência', 'ausencia', 'fora do escritório', 'fora do escritorio',
  'férias', 'ferias', 'estou ausente', 'auto: ',
];
const AUTO_REPLY_HEADERS = ['x-autoreply', 'x-autorespond', 'auto-submitted', 'x-auto-response-suppress'];

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
 * Classifica a mensagem. `ownEmails` = endereços das caixas do BDR (a própria e as irmãs).
 * `knownLeadEmail` = e-mail do lead da conversa, quando já conhecido (thread existente).
 */
export function classifyInbound({
  headers,
  ownEmails,
  isKnownLeadSender = false,
  mimeType,
}: {
  headers: InboundHeaders;
  ownEmails: string[];
  isKnownLeadSender?: boolean;
  mimeType?: string | null;
}): InboundKind {
  const from = extractEmailAddress(headers['from']) ?? '';
  const subject = (headers['subject'] ?? '').toLowerCase();

  if (from && ownEmails.map((e) => e.toLowerCase()).includes(from)) return 'own';

  if (BOUNCE_SENDERS.some((s) => from.includes(s)) || (mimeType ?? '').toLowerCase().startsWith('multipart/report')) {
    return 'bounce';
  }

  const autoSubmitted = (headers['auto-submitted'] ?? '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto_reply';
  if (AUTO_REPLY_HEADERS.some((h) => h !== 'auto-submitted' && headers[h] != null)) return 'auto_reply';
  if (AUTO_REPLY_SUBJECTS.some((s) => subject.includes(s))) return 'auto_reply';
  if ((headers['precedence'] ?? '').toLowerCase() === 'bulk' && !isKnownLeadSender) return 'auto_reply';

  if (!from) return 'unknown';
  return 'lead';
}

/** base64url (Gmail) → texto UTF-8. */
export function decodeBase64Url(data: string | undefined | null): string {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
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

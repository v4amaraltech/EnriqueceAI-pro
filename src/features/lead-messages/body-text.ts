import { stripQuotedReply } from '@/features/email-conversations/services/inbound-classifier';
import { toPlainText } from '@/lib/utils/html-to-plaintext';

/**
 * Texto da mensagem para lead_messages.body_text.
 * Puro, sem I/O: usado na captura (recordLeadMessage), na resposta do Gmail
 * e no script que preenche body_text vazio.
 */

const HTML_TAG = /<\/?(?:html|head|body|p|br|div|span|a|strong|b|em|i|u|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|td|th|img|pre|code|hr|font|center|style|script)\b[^>]*>/i;

/** Blocos do Gmail que não são o corpo novo: citação, linha "Em ... escreveu" e assinatura. */
const QUOTED_BLOCK = /<(div|blockquote)\b[^>]*(?:class\s*=\s*["'][^"']*\b(?:gmail_quote|gmail_attr|gmail_signature)\b[^"']*["']|id\s*=\s*["']gmail_signature["'])[^>]*>/i;
const PLAIN_BLOCKQUOTE = /<blockquote\b[^>]*>/i;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export interface BodyTextInput {
  bodyText?: string | null;
  bodyHtml?: string | null;
  channel: 'whatsapp' | 'email';
  direction: 'inbound' | 'outbound';
}

export function looksLikeHtml(value: string): boolean {
  return HTML_TAG.test(value);
}

/** Fim do elemento que abre em `start`, contando aninhamento da mesma tag. */
function elementEnd(html: string, start: number, tag: string): number {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return html.length;
}

function removeBlocks(html: string, opener: RegExp): string {
  let out = html;
  for (let guard = 0; guard < 50; guard++) {
    const match = opener.exec(out);
    if (!match) break;
    const tag = (match[1] ?? 'blockquote').toLowerCase();
    const end = elementEnd(out, match.index, tag);
    out = out.slice(0, match.index) + out.slice(end);
  }
  return out;
}

/** Tira citação e assinatura do Gmail. Só para e-mail de entrada. */
export function stripQuotedHtml(html: string): string {
  return removeBlocks(removeBlocks(html, QUOTED_BLOCK), PLAIN_BLOCKQUOTE);
}

function decodeNumericEntities(value: string): string {
  return value
    .replace(/&#(\d{1,7});/g, (match, code: string) => safeChar(Number(code), match))
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, code: string) => safeChar(parseInt(code, 16), match))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeChar(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
  return String.fromCodePoint(code);
}

/** HTML em texto limpo: sem script e style, blocos viram quebra de linha, entidades decodificadas. */
export function htmlToText(html: string): string {
  const prepared = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/<\/p\s*>/gi, '<br><br>')
    .replace(/<\/(div|li|tr|h[1-6]|blockquote|pre|table)\s*>/gi, '<br>')
    .replace(/<hr\b[^>]*>/gi, '<br>');
  const text = decodeNumericEntities(toPlainText(prepared).replace(/ /g, ' '));
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function quoteless(text: string, direction: BodyTextInput['direction'], channel: BodyTextInput['channel']): string {
  if (channel !== 'email' || direction !== 'inbound') return text;
  const stripped = stripQuotedReply(text);
  return stripped || text;
}

function fromHtml(html: string, input: BodyTextInput): string {
  if (input.channel === 'email' && input.direction === 'inbound') {
    const withoutQuote = htmlToText(stripQuotedHtml(html));
    if (withoutQuote) return quoteless(withoutQuote, input.direction, input.channel);
  }
  return quoteless(htmlToText(html), input.direction, input.channel);
}

/**
 * Texto do provedor ganha. Se ele parecer HTML, converte.
 * Sem texto, converte o HTML. Em e-mail de entrada corta citação e assinatura,
 * mas, se o corte apagar tudo, fica o texto inteiro.
 * Devolve null quando não sobra texto. Nunca devolve HTML cru.
 */
export function resolveLeadMessageBodyText(input: BodyTextInput): string | null {
  const raw = typeof input.bodyText === 'string' ? input.bodyText.trim() : '';
  if (raw) {
    const text = looksLikeHtml(raw) ? fromHtml(raw, input) : quoteless(raw.replace(/\r\n?/g, '\n'), input.direction, input.channel);
    if (text.trim()) return text.trim();
  }
  const html = typeof input.bodyHtml === 'string' ? input.bodyHtml.trim() : '';
  if (!html) return null;
  const text = fromHtml(html, input).trim();
  return text || null;
}

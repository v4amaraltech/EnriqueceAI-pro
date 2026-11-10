import DOMPurify from 'isomorphic-dompurify';

const HTML_TAG = /<\/?(?:p|br|div|span|a|strong|b|em|i|u|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|td|th|img|pre|code|hr)\b/i;
const LINKABLE = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trimTrail(raw: string): { core: string; trail: string } {
  const match = raw.match(/^(.*?)([),.;:!?]+)$/);
  if (!match?.[1]) return { core: raw, trail: '' };
  return { core: match[1], trail: match[2] ?? '' };
}

function anchor(core: string): string {
  const email = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(core);
  const href = email ? `mailto:${core}` : (core.startsWith('www.') ? `https://${core}` : core);
  if (!email && !/^https?:\/\//i.test(href)) return escapeHtml(core);
  return `<a href="${escapeHtml(href)}">${escapeHtml(core)}</a>`;
}

function autolink(plain: string): string {
  let out = '';
  let last = 0;
  for (const match of plain.matchAll(LINKABLE)) {
    const index = match.index ?? 0;
    out += escapeHtml(plain.slice(last, index));
    const { core, trail } = trimTrail(match[0]);
    out += anchor(core) + escapeHtml(trail);
    last = index + match[0].length;
  }
  out += escapeHtml(plain.slice(last));
  return out;
}

export function plainText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeHtml(value: string): boolean {
  return HTML_TAG.test(value);
}

export function plainToHtml(plain: string): string {
  const normalized = plain.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${autolink(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function lockLinks(node: Element): void {
  if (node.tagName !== 'A') return;
  const href = node.getAttribute('href') ?? '';
  if (!/^(https?:|mailto:)/i.test(href)) {
    node.removeAttribute('href');
    return;
  }
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
}

export function sanitizeChatHtml(dirty: string): string {
  DOMPurify.addHook('afterSanitizeAttributes', lockLinks);
  try {
    return DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS: [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a',
        'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'span', 'div', 'hr',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'img', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'video', 'audio'],
      FORBID_ATTR: ['style', 'src', 'srcset'],
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', lockLinks);
  }
}

function fromSource(raw: string): { text: string; html: string | null } {
  if (looksLikeHtml(raw)) {
    const html = sanitizeChatHtml(raw).trim();
    return { text: plainText(raw), html: html || null };
  }
  const plain = raw.replace(/\r\n/g, '\n').trim();
  if (!plain) return { text: '', html: null };
  if (/\n/.test(plain) || /https?:\/\/|www\.|@/.test(plain)) {
    const html = sanitizeChatHtml(plainToHtml(plain)).trim();
    return { text: plain, html: html || null };
  }
  return { text: plain, html: null };
}

export function messageBody(input: { html?: string | null; text?: string | null }): { text: string; html: string | null } {
  const html = typeof input.html === 'string' && input.html.trim() ? input.html : null;
  const text = typeof input.text === 'string' && input.text.trim() ? input.text : null;
  if (html && (looksLikeHtml(html) || !text)) return fromSource(html);
  if (text) return fromSource(text);
  if (html) return fromSource(html);
  return { text: '', html: null };
}

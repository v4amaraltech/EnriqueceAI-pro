const MAX_PART_CHARS = 200;
const MAX_TOTAL_CHARS = 600;
const MAX_CAUSE_DEPTH = 3;

/** Tira de mensagens qualquer coisa com cara de credencial ou URL assinada. */
function sanitize(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(bearer|basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1?[redacted]')
    .trim()
    .slice(0, MAX_PART_CHARS);
}

function describeCause(cause: unknown): string | null {
  if (cause === null || cause === undefined) return null;
  if (typeof cause === 'string') return sanitize(cause) || null;
  if (typeof cause !== 'object') return sanitize(String(cause)) || null;
  const c = cause as { code?: unknown; message?: unknown; name?: unknown };
  // Só code em texto (ECONNRESET, UND_ERR_*). DOMException tem code numérico sem significado útil.
  const code = typeof c.code === 'string' && c.code ? c.code : null;
  const msg = typeof c.message === 'string' && c.message ? sanitize(c.message) : null;
  const name = typeof c.name === 'string' && c.name !== 'Error' ? c.name : null;
  const label = code ?? name;
  if (label && msg && msg !== label) return `${label}: ${msg}`;
  return msg ?? label;
}

/**
 * Texto estável para a coluna `error` (text) de call_transcripts_v2 / call_qualifications.
 * Mensagem do erro primeiro (preserva prefixos do monitoramento, ex. duration_mismatch),
 * depois a cadeia de `cause` (code e message), ex.:
 *   "assemblyai_network_error: upload after 3 attempts (cause: TypeError: fetch failed <- ECONNRESET: read ECONNRESET)"
 * Nunca inclui stack, headers nem query string de URL.
 */
export function formatEngineError(err: unknown, fallback = 'unknown_error'): string {
  const base =
    err instanceof Error && err.message
      ? sanitize(err.message) || fallback
      : typeof err === 'string' && err
        ? sanitize(err)
        : fallback;
  const causes: string[] = [];
  let cur: unknown =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && cur !== undefined && cur !== null; depth++) {
    const part = describeCause(cur);
    if (part && !causes.includes(part)) causes.push(part);
    cur = typeof cur === 'object' ? (cur as { cause?: unknown }).cause : undefined;
  }
  const full = causes.length ? `${base} (cause: ${causes.join(' <- ')})` : base;
  return full.slice(0, MAX_TOTAL_CHARS);
}

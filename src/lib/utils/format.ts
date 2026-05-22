/**
 * Shared formatting utilities for pt-BR locale.
 *
 * Centralizes duplicate formatDate / formatDuration / formatRelativeTime
 * helpers that were previously copy-pasted across 15+ feature files.
 */

// ---------------------------------------------------------------------------
// Date formatters
// ---------------------------------------------------------------------------

/** DD/MM/YYYY */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** DD/MM/YYYY HH:mm */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "YYYY-MM-DD" → "DD/MM/YYYY" with no timezone shift.
 * Use this for date-only fields (e.g. custom_field `type: 'date'`,
 * `meeting_held_at`, won/lost dates without time). `new Date('2026-05-22')`
 * interprets the input as UTC midnight, so toLocaleDateString in BRT
 * silently turns 2026-05-22 into "21/05/2026". This helper avoids that.
 * Accepts full ISO timestamps too (strips the time portion).
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const datePart = value.length >= 10 ? value.slice(0, 10) : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * "YYYY-MM-DDTHH:mm" (datetime-local) or full ISO → "DD/MM/YYYY HH:mm".
 * Falls back to `formatDateTime` for full ISO timestamps that carry a
 * timezone. For naive datetime-local strings (no Z / offset) parses the
 * pieces directly so the value the user typed in their datetime input is
 * what they see back.
 */
export function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return '—';
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (naive) {
    const [, y, m, d, hh, mm] = naive;
    return `${d}/${m}/${y} ${hh}:${mm}`;
  }
  return formatDateTime(value);
}

/** DD/MM (for chart axis labels) */
export function formatDateLabel(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/** "agora", "5min", "2h", "3d", or full date (DD/MM/YYYY) */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

// ---------------------------------------------------------------------------
// Duration formatters
// ---------------------------------------------------------------------------

/** Seconds → "MM:SS" (zero-padded) */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Milliseconds → "MM:SS" (zero-padded) */
export function formatDurationMs(ms: number): string {
  return formatDuration(Math.max(0, Math.floor(ms / 1000)));
}

/** Seconds → "Xh Ym" long form */
export function formatDurationLong(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Number / currency
// ---------------------------------------------------------------------------

/** Safe percentage: avoids division by zero, returns one decimal (e.g. 42.5) */
export function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Format value in cents as BRL currency: 15000 → "R$ 150,00" */
export function formatCurrencyBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** Format a BRL value (not cents) with no decimals: 1500 → "R$ 1.500" */
export function formatCurrencyBRLCompact(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

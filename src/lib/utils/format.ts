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

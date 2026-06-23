/**
 * Formats a meeting datetime for human-readable timeline messages
 * (e.g. "Reunião remarcada de 23/06/2026, 09:00 para 23/06/2026, 17:30").
 *
 * Meeting times are stored as NAIVE ISO strings ("2026-06-23T17:30:00") that
 * already represent America/Sao_Paulo wall-clock time — the scheduling modal
 * builds them as `${date}T${time}:00` with no timezone, and Google Calendar
 * receives them alongside an explicit `timeZone: 'America/Sao_Paulo'`.
 *
 * Passing such a naive string through `new Date(iso).toLocaleString(...)` on a
 * UTC server (Coolify) reinterprets it as UTC and then shifts it −3h when
 * converting to São Paulo. That is exactly why the timeline once logged
 * "remarcada de 06:00 para 14:30" for a real 09:00 → 17:30 move.
 *
 * This formats the wall-clock components directly, with no timezone math, so a
 * naive São Paulo time renders exactly as entered. Strings that DO carry a
 * timezone (trailing `Z` or `±HH:MM` offset) fall back to a proper TZ-aware
 * conversion to São Paulo.
 */
export function formatMeetingDateTime(iso: string): string {
  const naive = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);

  if (naive && !hasZone) {
    const [, year, month, day, hour, minute] = naive;
    return `${day}/${month}/${year}, ${hour}:${minute}`;
  }

  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

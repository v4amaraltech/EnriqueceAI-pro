/**
 * A linha de `calls` prova que a ligação acabou?
 *
 * O channel-answer não grava `hangup_cause` e deixa `status` em
 * `not_connected` — a tela continua. O channel-hangup sem atendimento
 * (NUMBER_CHANGED e outras causas não conectadas) também permanece
 * `not_connected`, mas grava a causa. Olhar só `status !== not_connected`
 * deixava o dock em "Em chamada" depois que o provedor já tinha desligado.
 */
const TERMINAL_STATUSES = new Set(['significant', 'not_significant', 'busy', 'no_contact']);

export interface CallHangupRow {
  id?: string;
  status?: string | null;
  hangup_cause?: string | null;
  duration_seconds?: number | null;
}

export function hangupFromCallRow(row: CallHangupRow | null | undefined): { durationSeconds: number } | null {
  if (!row) return null;
  const cause = typeof row.hangup_cause === 'string' ? row.hangup_cause.trim() : '';
  const status = row.status ?? null;
  const ended = cause.length > 0 || (status !== null && TERMINAL_STATUSES.has(status));
  if (!ended) return null;
  const duration = row.duration_seconds;
  return { durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0 };
}

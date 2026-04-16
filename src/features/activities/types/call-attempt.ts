export interface CallAttempt {
  attemptNumber: number;
  phone: string;
  status: string;
  notes: string;
  durationSeconds: number;
}

export const MAX_CALL_ATTEMPTS = 3;

const STATUS_PRIORITY: Record<string, number> = {
  meeting_scheduled: 6,
  connected: 5,
  gatekeeper: 4,
  voicemail: 3,
  busy: 2,
  no_answer: 1,
  wrong_number: 0,
};

const STATUS_LABELS: Record<string, string> = {
  meeting_scheduled: 'Reunião agendada',
  connected: 'Conectou — falou com decisor',
  gatekeeper: 'Conectou — falou com intermediário',
  voicemail: 'Caixa postal',
  busy: 'Ocupado',
  no_answer: 'Não atendeu',
  wrong_number: 'Número errado',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function pickBestStatus(attempts: CallAttempt[]): string {
  if (attempts.length === 0) return '';
  let best = attempts[0]!;
  for (const a of attempts) {
    if ((STATUS_PRIORITY[a.status] ?? -1) > (STATUS_PRIORITY[best.status] ?? -1)) {
      best = a;
    }
  }
  return best.status;
}

export function formatAggregatedNotes(attempts: CallAttempt[]): string {
  if (attempts.length === 1) {
    const a = attempts[0]!;
    return `[${statusLabel(a.status)}] ${a.notes}`.trim();
  }
  return attempts
    .map((a) => `[Tentativa ${a.attemptNumber}] ${a.phone} - [${statusLabel(a.status)}] ${a.notes} (${a.durationSeconds}s)`)
    .join('\n');
}

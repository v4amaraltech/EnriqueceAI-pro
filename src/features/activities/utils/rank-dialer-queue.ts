import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import {
  leadSignalScore,
  type NextLeadInteraction,
} from '@/features/cockpit/utils/next-lead';

/** Intervalo para recarregar a fila quando a prioridade está ligada. */
export const DIALER_PRIORITY_REFRESH_MS = 30_000;

export interface DialerLeadSignal {
  leadId: string;
  noShowAt: string | null;
  updatedAt: string;
}

const LOCKED_AUTO_PHASES = new Set([
  'dialing',
  'awaiting-session',
  'in-call',
  'resolving',
  'auto-completing',
  'releasing',
  'advancing',
  'awaiting-sdr',
]);

const LOCKED_CALL_STATES = new Set([
  'calling',
  'awaiting-session',
  'connected',
  'releasing',
]);

/** Não troca o lead da vez no meio de uma ligação ou da conclusão. */
export function isDialerQueueRefreshLocked(autoPhase: string, callState: string): boolean {
  return LOCKED_AUTO_PHASES.has(autoPhase) || LOCKED_CALL_STATES.has(callState);
}

/**
 * Ordena a fila: sinal (resposta, no-show, abertura/clique), depois cadência
 * mais atrasada, depois recência do lead. Empate estável pela ordem de entrada.
 */
export function rankDialerQueue(
  items: readonly DialerQueueItem[],
  input: {
    signals: readonly DialerLeadSignal[];
    interactions: readonly NextLeadInteraction[];
    now: Date;
  },
): DialerQueueItem[] {
  const signalByLead = new Map(input.signals.map((s) => [s.leadId, s]));
  const scored = items.map((item, index) => {
    const signal = signalByLead.get(item.leadId);
    const score = leadSignalScore(
      { id: item.leadId, noShowAt: signal?.noShowAt ?? null },
      input.interactions,
      input.now,
    );
    const due = Date.parse(item.nextStepDue);
    const recency = signal?.updatedAt ? Date.parse(signal.updatedAt) : Number.NaN;
    return {
      item,
      index,
      score,
      due: Number.isFinite(due) ? due : Number.POSITIVE_INFINITY,
      recency: Number.isFinite(recency) ? recency : 0,
    };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.due !== b.due) return a.due - b.due;
    if (b.recency !== a.recency) return b.recency - a.recency;
    return a.index - b.index;
  });
  return scored.map((row) => row.item);
}

export function mergeDialerQueueRefresh(input: {
  previous: readonly DialerQueueItem[];
  incoming: readonly DialerQueueItem[];
  currentEnrollmentId: string | null;
  sessionLeadEnrollment: ReadonlyMap<string, string>;
  lockCurrent: boolean;
}): DialerQueueItem[] {
  const { previous, incoming, currentEnrollmentId, sessionLeadEnrollment, lockCurrent } = input;
  const currentItem =
    (currentEnrollmentId
      ? previous.find((item) => item.enrollmentId === currentEnrollmentId)
      : undefined)
    ?? incoming.find((item) => item.enrollmentId === currentEnrollmentId);

  const isOtherEnrollmentOfDialedLead = (item: DialerQueueItem) => {
    const first = sessionLeadEnrollment.get(item.leadId);
    return Boolean(first && first !== item.enrollmentId);
  };

  const seen = new Set<string>();
  const out: DialerQueueItem[] = [];
  const push = (item: DialerQueueItem) => {
    if (seen.has(item.enrollmentId)) return;
    if (isOtherEnrollmentOfDialedLead(item) && item.enrollmentId !== currentEnrollmentId) return;
    seen.add(item.enrollmentId);
    out.push(item);
  };

  for (const item of incoming) push(item);

  if (lockCurrent && currentItem && !seen.has(currentItem.enrollmentId)) {
    out.unshift(currentItem);
  }

  return out;
}

import { describe, expect, it } from 'vitest';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import {
  isDialerQueueRefreshLocked,
  mergeDialerQueueRefresh,
  rankDialerQueue,
} from './rank-dialer-queue';

function item(id: string, over: Partial<DialerQueueItem> = {}): DialerQueueItem {
  return {
    enrollmentId: `e-${id}`,
    leadId: `l-${id}`,
    leadName: id,
    firstName: null,
    lastName: null,
    companyName: id,
    phone: '(11) 99999-0000',
    phones: [],
    cadenceName: 'C',
    cadenceId: 'c',
    stepId: 's',
    stepOrder: 1,
    totalSteps: 3,
    nextStepDue: '2026-11-10T12:00:00Z',
    activityName: null,
    callScript: null,
    currentStepIsPhone: true,
    phoneAttempts: [],
    ...over,
  };
}

const now = new Date('2026-11-14T15:00:00Z');

describe('rankDialerQueue', () => {
  it('ordena por resposta, no-show, abertura/clique, depois cadência atrasada e recência', () => {
    const overdue = item('overdue', { nextStepDue: '2026-11-01T12:00:00Z' });
    const opened = item('opened', { nextStepDue: '2026-11-12T12:00:00Z' });
    const replied = item('replied', { nextStepDue: '2026-11-13T12:00:00Z' });
    const noShow = item('noshow', { nextStepDue: '2026-11-12T15:00:00Z' });
    const recent = item('recent', { nextStepDue: '2026-11-10T12:00:00Z' });
    const older = item('older', { nextStepDue: '2026-11-10T12:00:00Z' });

    const ranked = rankDialerQueue(
      [older, recent, opened, overdue, noShow, replied],
      {
        signals: [
          { leadId: 'l-overdue', noShowAt: null, updatedAt: '2026-11-01T00:00:00Z' },
          { leadId: 'l-opened', noShowAt: null, updatedAt: '2026-11-12T00:00:00Z' },
          { leadId: 'l-replied', noShowAt: null, updatedAt: '2026-11-13T00:00:00Z' },
          { leadId: 'l-noshow', noShowAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T00:00:00Z' },
          { leadId: 'l-recent', noShowAt: null, updatedAt: '2026-11-14T10:00:00Z' },
          { leadId: 'l-older', noShowAt: null, updatedAt: '2026-11-02T00:00:00Z' },
        ],
        interactions: [
          { leadId: 'l-replied', type: 'replied', at: '2026-11-13T18:00:00Z' },
          { leadId: 'l-opened', type: 'opened', at: '2026-11-13T18:00:00Z' },
        ],
        now,
      },
    );

    expect(ranked.map((i) => i.leadId)).toEqual([
      'l-replied',
      'l-noshow',
      'l-opened',
      'l-overdue',
      'l-recent',
      'l-older',
    ]);
  });

  it('aceita resposta de WhatsApp pelo mesmo tipo replied', () => {
    const whatsapp = item('wa', { nextStepDue: '2026-11-13T12:00:00Z' });
    const rest = item('rest', { nextStepDue: '2026-11-01T12:00:00Z' });
    const ranked = rankDialerQueue([rest, whatsapp], {
      signals: [
        { leadId: 'l-wa', noShowAt: null, updatedAt: '2026-11-01T00:00:00Z' },
        { leadId: 'l-rest', noShowAt: null, updatedAt: '2026-11-14T00:00:00Z' },
      ],
      interactions: [{ leadId: 'l-wa', type: 'replied', at: '2026-11-14T10:00:00Z' }],
      now,
    });
    expect(ranked[0]?.leadId).toBe('l-wa');
  });
});

describe('mergeDialerQueueRefresh', () => {
  it('mantém o lead em ligação mesmo se ele sair da fila nova', () => {
    const current = item('a');
    const incoming = [item('b'), item('c')];
    const merged = mergeDialerQueueRefresh({
      previous: [current, item('b')],
      incoming,
      currentEnrollmentId: 'e-a',
      sessionLeadEnrollment: new Map([['l-a', 'e-a']]),
      lockCurrent: true,
    });
    expect(merged[0]?.enrollmentId).toBe('e-a');
    expect(merged.map((i) => i.enrollmentId)).toEqual(['e-a', 'e-b', 'e-c']);
  });

  it('não junta outra inscrição do lead já discado na sessão', () => {
    const first = item('a');
    const otherEnrollment = item('a2', { leadId: 'l-a', enrollmentId: 'e-a2' });
    const otherLead = item('b');
    const merged = mergeDialerQueueRefresh({
      previous: [first],
      incoming: [otherEnrollment, otherLead],
      currentEnrollmentId: 'e-a',
      sessionLeadEnrollment: new Map([['l-a', 'e-a']]),
      lockCurrent: false,
    });
    expect(merged.map((i) => i.enrollmentId)).toEqual(['e-b']);
  });

  it('sem trava, troca a ordem pela fila nova', () => {
    const merged = mergeDialerQueueRefresh({
      previous: [item('a'), item('b')],
      incoming: [item('b'), item('a')],
      currentEnrollmentId: 'e-a',
      sessionLeadEnrollment: new Map(),
      lockCurrent: false,
    });
    expect(merged.map((i) => i.enrollmentId)).toEqual(['e-b', 'e-a']);
  });
});

describe('isDialerQueueRefreshLocked', () => {
  it('trava no meio da ligação e libera na contagem e na pausa', () => {
    expect(isDialerQueueRefreshLocked('in-call', 'idle')).toBe(true);
    expect(isDialerQueueRefreshLocked('countdown', 'connected')).toBe(true);
    expect(isDialerQueueRefreshLocked('awaiting-sdr', 'ended')).toBe(true);
    expect(isDialerQueueRefreshLocked('countdown', 'idle')).toBe(false);
    expect(isDialerQueueRefreshLocked('paused', 'idle')).toBe(false);
    expect(isDialerQueueRefreshLocked('off', 'ended')).toBe(false);
  });
});

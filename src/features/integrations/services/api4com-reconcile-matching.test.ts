import { describe, expect, it } from 'vitest';

import {
  destinationSuffix,
  groupCallsForReconcile,
  isLinkedToApi4ComCall,
  pickFallbackCandidate,
  type FallbackCandidate,
} from './api4com-reconcile-matching';

const row = (
  id: string,
  startedAt: string,
  overrides: Partial<FallbackCandidate> = {},
): FallbackCandidate => ({
  id,
  started_at: startedAt,
  hangup_cause: null,
  metadata: { api4com_call_id: `dialer-${id}` },
  ...overrides,
});

describe('destinationSuffix', () => {
  it('keeps the last 8 digits, ignoring formatting', () => {
    expect(destinationSuffix('+55 (11) 99888-1124')).toBe('98881124');
  });
});

describe('groupCallsForReconcile', () => {
  it('groups by ramal + number and sorts each group by time', () => {
    const groups = groupCallsForReconcile([
      { id: 'b', from: '1025', to: '5511998881124', started_at: '2026-09-10T17:22:00.000Z' },
      { id: 'x', from: '1023', to: '5511998881124', started_at: '2026-09-10T17:20:00.000Z' },
      { id: 'a', from: '1025', to: '011 99888-1124', started_at: '2026-09-10T17:18:00.000Z' },
    ]);

    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['a', 'b'], ['x']]);
  });

  it('gives calls without from/to a group of their own', () => {
    const groups = groupCallsForReconcile([
      { id: 'no-to', from: '1025' },
      { id: 'no-from', to: '5511998881124' },
    ]);

    expect(groups).toHaveLength(2);
  });
});

describe('isLinkedToApi4ComCall', () => {
  it('treats webhook-linked, reconcile-inserted and alt-id rows as linked', () => {
    expect(isLinkedToApi4ComCall({ webhook_linked: true })).toBe(true);
    expect(isLinkedToApi4ComCall({ source: 'reconcile_api4com' })).toBe(true);
    expect(isLinkedToApi4ComCall({ alt_api4com_ids: ['abc'] })).toBe(true);
  });

  it('treats a fresh dialer row as not linked', () => {
    expect(isLinkedToApi4ComCall({ api4com_call_id: 'req-1', gateway: 'flux-org' })).toBe(false);
    expect(isLinkedToApi4ComCall(null)).toBe(false);
  });
});

describe('pickFallbackCandidate', () => {
  const target = Date.parse('2026-09-10T17:18:55.000Z');

  it('picks the closest row, not the oldest', () => {
    const rows = [
      row('old', '2026-09-10T17:12:00.000Z'),
      row('close', '2026-09-10T17:19:22.000Z'),
      row('late', '2026-09-10T17:22:24.000Z'),
    ];

    expect(pickFallbackCandidate(rows, target, 'NO_ANSWER')?.id).toBe('close');
  });

  it('skips rows already linked to another API4COM call', () => {
    const rows = [
      row('linked', '2026-09-10T17:18:55.000Z', { metadata: { webhook_linked: true, alt_api4com_ids: ['x'] } }),
      row('free', '2026-09-10T17:22:24.000Z'),
    ];

    expect(pickFallbackCandidate(rows, target, 'NO_ANSWER')?.id).toBe('free');
  });

  it('skips rows the reconcile inserted itself', () => {
    const rows = [row('inserted', '2026-09-10T17:18:55.000Z', { metadata: { source: 'reconcile_api4com' } })];

    expect(pickFallbackCandidate(rows, target, 'NO_ANSWER')).toBeNull();
  });

  it('skips rows with a different hangup_cause', () => {
    const rows = [
      row('voicemail', '2026-09-10T17:18:55.000Z', { hangup_cause: 'NUMBER_CHANGED' }),
      row('pending', '2026-09-10T17:21:00.000Z'),
    ];

    expect(pickFallbackCandidate(rows, target, 'NORMAL_CLEARING')?.id).toBe('pending');
  });

  it('breaks ties by the earliest row', () => {
    const rows = [row('after', '2026-09-10T17:19:55.000Z'), row('before', '2026-09-10T17:17:55.000Z')];

    expect(pickFallbackCandidate(rows, target, null)?.id).toBe('before');
  });

  it('returns null when nothing qualifies', () => {
    expect(pickFallbackCandidate([], target, null)).toBeNull();
    expect(pickFallbackCandidate([row('no-start', '', { started_at: null })], target, null)).toBeNull();
  });

  // Regression of the 2026-09-10 backfill: three dialer rows for the same
  // number, three REST calls processed in order — each must land on its own row.
  it('spreads sequential redials over distinct rows', () => {
    const rows = [
      row('r1', '2026-09-10T12:04:16.000Z'),
      row('r2', '2026-09-10T12:04:31.000Z'),
      row('r3', '2026-09-10T12:04:45.000Z'),
    ];
    const restCalls = ['2026-09-10T12:04:15.000Z', '2026-09-10T12:04:31.000Z', '2026-09-10T12:04:46.000Z'];

    const linked: string[] = [];
    for (const startedAt of restCalls) {
      const pick = pickFallbackCandidate(rows, Date.parse(startedAt), 'ORIGINATOR_CANCEL');
      expect(pick).not.toBeNull();
      linked.push(pick!.id);
      // The worker marks the row as linked when it stores the alt id.
      pick!.metadata = { ...pick!.metadata, webhook_linked: true, alt_api4com_ids: [startedAt] };
    }

    expect(linked).toEqual(['r1', 'r2', 'r3']);
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  destinationSuffix,
  groupCallsForReconcile,
  isLinkedToApi4ComCall,
  pickFallbackCandidate,
  reconcileInsertMetadata,
  reconcileLinkMetadata,
  resolveReconcileMatch,
  type FallbackCandidate,
  type ReconcileLookups,
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

describe('resolveReconcileMatch (callRef)', () => {
  const REF = '6f1c2a3e-1234-4abc-8def-0123456789ab';
  const rest = (over: Record<string, unknown> = {}) => ({
    id: 'chan-1',
    from: '1025',
    to: '5511998881124',
    started_at: '2026-11-12T15:00:00.000Z',
    hangup_cause: 'NORMAL_CLEARING',
    metadata: { gateway: 'flux-org', callRef: REF } as Record<string, unknown>,
    ...over,
  });

  function lookups(rows: {
    byId?: FallbackCandidate | null;
    byRefMeta?: FallbackCandidate | null;
    primary?: FallbackCandidate | null;
    alt?: FallbackCandidate | null;
    window?: FallbackCandidate[];
  }) {
    return {
      byId: vi.fn(async () => rows.byId ?? null),
      byCallRefMetadata: vi.fn(async () => rows.byRefMeta ?? null),
      byPrimaryId: vi.fn(async () => rows.primary ?? null),
      byAltId: vi.fn(async () => rows.alt ?? null),
      fallbackCandidates: vi.fn(async () => rows.window ?? []),
    } satisfies ReconcileLookups<FallbackCandidate>;
  }

  it('callRef ganha de um candidato de janela, sem gate de hangup_cause', async () => {
    const own = row(REF, '2026-11-12T14:52:00.000Z', {
      hangup_cause: 'NO_ANSWER',
      metadata: { callRef: REF, gateway: 'flux-org' },
    });
    const closer = row('closer', '2026-11-12T15:00:00.000Z');
    const l = lookups({ byId: own, window: [closer] });

    const match = await resolveReconcileMatch(rest(), l);

    expect(match).toEqual({ row: own, via: 'call_ref' });
    expect(l.byId).toHaveBeenCalledWith(REF);
    expect(l.fallbackCandidates).not.toHaveBeenCalled();
  });

  it('cai no metadata->>callRef quando o id não acha', async () => {
    const own = row('other-id', '2026-11-12T15:00:00.000Z', { metadata: { callRef: REF } });
    const l = lookups({ byRefMeta: own });

    expect((await resolveReconcileMatch(rest(), l))?.via).toBe('call_ref');
  });

  it('sem callRef o caminho atual permanece (id, alt com gate, janela)', async () => {
    const closest = row('b', '2026-11-12T15:01:00.000Z');
    const l = lookups({
      alt: row('alt', '2026-11-12T15:00:00.000Z', { hangup_cause: 'NUMBER_CHANGED' }),
      window: [row('a', '2026-11-12T14:52:00.000Z'), closest],
    });

    const match = await resolveReconcileMatch(rest({ metadata: { callRef: 'lixo' } }), l);

    expect(l.byId).not.toHaveBeenCalled();
    expect(match).toEqual({ row: closest, via: 'fallback' });
    expect(l.fallbackCandidates).toHaveBeenCalledWith({
      origin: '1025',
      suffix: '98881124',
      loIso: '2026-11-12T14:50:00.000Z',
      hiIso: '2026-11-12T15:10:00.000Z',
    });
  });

  it('id primário vem antes do alt e da janela', async () => {
    const primary = row('p', '2026-11-12T15:00:00.000Z');
    const l = lookups({ primary, window: [row('w', '2026-11-12T15:00:00.000Z')] });

    expect(await resolveReconcileMatch(rest({ metadata: {} }), l)).toEqual({ row: primary, via: 'primary_id' });
  });

  it('merge pelo callRef grava o id e preserva callRef, gateway e o resto', () => {
    expect(reconcileLinkMetadata({ callRef: REF, gateway: 'g', live_amd: { p: 1 } }, 'chan-1', 'call_ref')).toEqual({
      callRef: REF,
      gateway: 'g',
      live_amd: { p: 1 },
      api4com_call_id: 'chan-1',
      webhook_linked: true,
    });
    expect(
      reconcileLinkMetadata({ callRef: REF, api4com_call_id: 'chan-1', webhook_linked: true }, 'chan-1', 'call_ref'),
    ).toBeNull();
  });

  it('merge pelo fallback mantém o comportamento de antes', () => {
    expect(reconcileLinkMetadata({ api4com_call_id: 'req-1' }, 'chan-1', 'fallback')).toEqual({
      api4com_call_id: 'req-1',
      alt_api4com_ids: ['chan-1'],
      webhook_linked: true,
    });
    expect(reconcileLinkMetadata({ api4com_call_id: 'chan-1' }, 'chan-1', 'primary_id')).toBeNull();
  });

  it('insert novo copia o callRef do registro REST', () => {
    expect(reconcileInsertMetadata(rest({ call_type: 'outbound' }), 'chan-1')).toEqual({
      api4com_call_id: 'chan-1',
      source: 'reconcile_api4com',
      hangup_cause: 'NORMAL_CLEARING',
      call_type: 'outbound',
      callRef: REF,
    });
    expect(reconcileInsertMetadata(rest({ metadata: {} }), 'chan-1')).not.toHaveProperty('callRef');
  });
});

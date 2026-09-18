import { describe, expect, it } from 'vitest';

import { findZeroFetchCandidates, isBrazilBusinessHours } from './api4com-reconcile-health';

describe('isBrazilBusinessHours', () => {
  it('accepts weekdays 08:00–17:59 in São Paulo time', () => {
    expect(isBrazilBusinessHours(new Date('2026-09-10T11:00:00Z'))).toBe(true); // qui 08:00 BRT
    expect(isBrazilBusinessHours(new Date('2026-09-10T20:59:00Z'))).toBe(true); // qui 17:59 BRT
  });

  it('rejects early morning, evening and weekends', () => {
    expect(isBrazilBusinessHours(new Date('2026-09-10T10:59:00Z'))).toBe(false); // qui 07:59 BRT
    expect(isBrazilBusinessHours(new Date('2026-09-10T21:00:00Z'))).toBe(false); // qui 18:00 BRT
    expect(isBrazilBusinessHours(new Date('2026-09-11T02:00:00Z'))).toBe(false); // qui 23:00 BRT (sex em UTC)
    expect(isBrazilBusinessHours(new Date('2026-09-12T15:00:00Z'))).toBe(false); // sáb 12:00 BRT
  });
});

describe('findZeroFetchCandidates', () => {
  const runAt = '2026-09-10T17:00:00.000Z'; // qui 14:00 BRT

  it('returns orgs with fetched 0 and no errors, with the evidence window', () => {
    const candidates = findZeroFetchCandidates({
      last_run_at: runAt,
      metadata: {
        windowHours: 1.5,
        orgs: [
          { org_id: 'julio', fetched: 0, errors: 0 },
          { org_id: 'amaral', fetched: 132, errors: 0 },
          { org_id: 'broken', fetched: 0, errors: 2 },
        ],
      },
    });

    expect(candidates).toEqual([
      {
        orgId: 'julio',
        evidenceSince: '2026-09-10T15:30:00.000Z',
        evidenceUntil: '2026-09-10T16:50:00.000Z',
      },
    ]);
  });

  it('ignores runs outside business hours', () => {
    const candidates = findZeroFetchCandidates({
      last_run_at: '2026-09-11T01:00:00.000Z', // qui 22:00 BRT
      metadata: { windowHours: 1.5, orgs: [{ org_id: 'julio', fetched: 0, errors: 0 }] },
    });

    expect(candidates).toEqual([]);
  });

  it('ignores missing or malformed state', () => {
    expect(findZeroFetchCandidates(null)).toEqual([]);
    expect(findZeroFetchCandidates({ last_run_at: null, metadata: {} })).toEqual([]);
    expect(findZeroFetchCandidates({ last_run_at: runAt, metadata: { orgs: 'x' } })).toEqual([]);
    expect(findZeroFetchCandidates({ last_run_at: runAt, metadata: null })).toEqual([]);
  });
});

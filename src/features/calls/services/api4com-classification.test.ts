import { describe, expect, it } from 'vitest';

import { classifyApi4ComCall } from './api4com-classification';

describe('classifyApi4ComCall', () => {
  const threshold = 30;

  describe('webhook path (answeredAt available)', () => {
    it('long answered call → connected + significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T14:00:00Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 120,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'significant' });
    });

    it('short answered call (10s, well under threshold) → connected + not_significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T21:05:30Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 10,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'not_significant' });
    });

    it('44s call with org threshold=50s (the old hardcoded gate) → still connected, but not_significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T21:05:30Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 44,
        significantThresholdSeconds: 50,
      });
      // Old code: would have been status='no_contact', connected=false (bug).
      // New code: connected=true regardless of threshold, status downgraded.
      expect(out).toEqual({ connected: true, status: 'not_significant' });
    });

    it('answered at threshold boundary (=threshold) → significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T14:00:00Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 30,
        significantThresholdSeconds: 30,
      });
      expect(out.status).toBe('significant');
    });

    it('no answer + NO_ANSWER cause → not connected + no_contact', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'NO_ANSWER',
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'no_contact' });
    });

    it('no answer + USER_BUSY → not connected + busy', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'USER_BUSY',
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'busy' });
    });

    it('no answer + CALL_REJECTED → not connected + not_connected', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'CALL_REJECTED',
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'not_connected' });
    });

    it('NORMAL_CLEARING without answeredAt and duration=0 → not connected (rang but never picked up)', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'no_contact' });
    });
  });

  describe('REST path (answeredAt unavailable)', () => {
    it('NORMAL_CLEARING + duration>0 → connected (the reconcile proxy)', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 75,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'significant' });
    });

    it('NORMAL_CLEARING + duration 5s → connected + not_significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 5,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'not_significant' });
    });

    it('unknown hangup cause → not_connected fallback', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'MYSTERY_CAUSE',
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'no_contact' });
    });

    it('missing hangup cause + duration=0 → not_connected fallback', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: null,
        durationSeconds: 0,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'no_contact' });
    });
  });

  describe('duration fallback (no answeredAt, no hangup_cause — broken-webhook ramais)', () => {
    it('missing hangup cause + duration ≥15s (short) → connected + not_significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: null,
        durationSeconds: 21, // typical V4 Amaral ramal 1042 talk time
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'not_significant' });
    });

    it('missing hangup cause + duration ≥ significant threshold → connected + significant', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: null,
        durationSeconds: 90,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'significant' });
    });

    it('missing hangup cause at the 15s floor → connected (boundary)', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: null,
        durationSeconds: 15,
        significantThresholdSeconds: threshold,
      });
      expect(out.connected).toBe(true);
      expect(out.status).toBe('not_significant');
    });

    it('missing hangup cause just below the 15s floor → stays not connected', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: null,
        durationSeconds: 14,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'no_contact' });
    });

    it('empty-string hangup cause + long duration → treated as missing → connected', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: '',
        durationSeconds: 40,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: true, status: 'significant' });
    });

    it('healthy ramal: explicit USER_BUSY with long duration is NOT upgraded by the fallback', () => {
      // The fallback must never override an explicit not-connected cause —
      // otherwise the working ramais would start over-counting.
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'USER_BUSY',
        durationSeconds: 60,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'busy' });
    });

    it('healthy ramal: ORIGINATOR_CANCEL with talk time stays not_connected (no fallback)', () => {
      const out = classifyApi4ComCall({
        answeredAt: null,
        hangupCause: 'ORIGINATOR_CANCEL',
        durationSeconds: 40,
        significantThresholdSeconds: threshold,
      });
      expect(out).toEqual({ connected: false, status: 'not_connected' });
    });
  });

  describe('regression: old hardcoded 50s threshold', () => {
    it('44s call with custom 15s threshold is significant (was no_contact with old 50s gate)', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T21:05:30Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 44,
        significantThresholdSeconds: 15,
      });
      expect(out.status).toBe('significant');
      expect(out.connected).toBe(true);
    });

    it('20s call with default 30s threshold is not_significant (but connected)', () => {
      const out = classifyApi4ComCall({
        answeredAt: '2026-05-15T21:05:00Z',
        hangupCause: 'NORMAL_CLEARING',
        durationSeconds: 20,
        significantThresholdSeconds: 30,
      });
      expect(out.status).toBe('not_significant');
      expect(out.connected).toBe(true);
    });
  });
});

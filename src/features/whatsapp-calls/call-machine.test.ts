import { describe, expect, it } from 'vitest';

import { INITIAL_CALL_STATE, callReducer, type CallState } from './call-machine';

describe('callReducer', () => {
  it('walks the happy path idle → ringing → active → ended', () => {
    let s: CallState = INITIAL_CALL_STATE;
    s = callReducer(s, { type: 'DIAL' });
    expect(s.status).toBe('requesting-mic');
    s = callReducer(s, { type: 'CALL_STARTED' });
    expect(s.status).toBe('ringing');
    s = callReducer(s, { type: 'ANSWERED', at: 1000 });
    expect(s).toEqual({ status: 'active', startedAt: 1000 });
    s = callReducer(s, { type: 'HANGUP' });
    expect(s.status).toBe('ended');
  });

  it('goes to mic-denied error when the mic is refused', () => {
    const s = callReducer({ status: 'requesting-mic' }, { type: 'MIC_DENIED' });
    expect(s).toEqual({ status: 'error', kind: 'mic-denied', message: expect.any(String) });
  });

  it('goes to service-error on a failed start', () => {
    const s = callReducer({ status: 'requesting-mic' }, { type: 'SERVICE_ERROR', message: 'boom' });
    expect(s).toEqual({ status: 'error', kind: 'service-error', message: 'boom' });
  });

  it('hangs up directly from ringing (no answer)', () => {
    expect(callReducer({ status: 'ringing' }, { type: 'HANGUP' }).status).toBe('ended');
  });

  it('ignores ANSWERED unless ringing', () => {
    expect(callReducer({ status: 'idle' }, { type: 'ANSWERED', at: 1 }).status).toBe('idle');
  });

  it('RESET returns to idle from any state', () => {
    expect(callReducer({ status: 'active', startedAt: 1 }, { type: 'RESET' }).status).toBe('idle');
    expect(callReducer({ status: 'error', kind: 'service-error', message: 'x' }, { type: 'RESET' }).status).toBe('idle');
  });
});

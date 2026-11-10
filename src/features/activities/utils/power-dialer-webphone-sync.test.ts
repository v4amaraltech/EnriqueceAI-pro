import { describe, expect, it } from 'vitest';

import { nextRamalAttempt, RAMAL_RELEASE_WINDOW_MS, sessionOfThisDial } from './power-dialer-webphone-sync';

describe('sessionOfThisDial', () => {
  const live = { integrated: true, phase: 'in-call', dialToken: 'dial-1' };

  it('a sessão integrada com o token deste clique está ao vivo', () => {
    expect(sessionOfThisDial(live, 'dial-1')).toBe('live');
    expect(sessionOfThisDial({ ...live, phase: 'ringing' }, 'dial-1')).toBe('live');
  });

  it('o BYE desse token encerra só esta discagem', () => {
    expect(sessionOfThisDial({ ...live, phase: 'ended' }, 'dial-1')).toBe('ended');
  });

  it('token velho, outra sessão ou sessão sem token não servem', () => {
    expect(sessionOfThisDial(live, 'dial-2')).toBe('none');
    expect(sessionOfThisDial({ ...live, dialToken: null }, 'dial-1')).toBe('none');
    expect(sessionOfThisDial({ ...live, integrated: false }, 'dial-1')).toBe('none');
    expect(sessionOfThisDial(null, 'dial-1')).toBe('none');
    expect(sessionOfThisDial(live, null)).toBe('none');
  });
});

describe('nextRamalAttempt', () => {
  const endedAt = 1_000_000;

  it('espera só o que falta da folga documentada e não repete a tentativa', () => {
    expect(nextRamalAttempt({ sessionEndedAt: endedAt, now: endedAt + 2_000, alreadyRetried: false })).toEqual({
      action: 'wait',
      waitMs: RAMAL_RELEASE_WINDOW_MS - 2_000,
    });
    expect(nextRamalAttempt({ sessionEndedAt: endedAt, now: endedAt + 2_000, alreadyRetried: true })).toEqual({
      action: 'pause',
    });
  });

  it('se a folga já passou e o ramal segue ocupado, não disca de novo na hora', () => {
    expect(nextRamalAttempt({ sessionEndedAt: endedAt, now: endedAt + RAMAL_RELEASE_WINDOW_MS, alreadyRetried: false })).toEqual({
      action: 'pause',
    });
  });

  it('sem hora de fim local, uma espera conta a partir de agora', () => {
    expect(nextRamalAttempt({ sessionEndedAt: null, now: 50, alreadyRetried: false })).toEqual({
      action: 'wait',
      waitMs: RAMAL_RELEASE_WINDOW_MS,
    });
  });
});

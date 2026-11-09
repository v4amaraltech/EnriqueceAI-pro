import { describe, expect, it } from 'vitest';

import { integratedSessionEndedThisDial } from './webphone-session-end';

const DIAL_AT = 1_700_000_000_000;

describe('integratedSessionEndedThisDial', () => {
  it('encerra quando a sessão integrada desta discagem caiu', () => {
    expect(
      integratedSessionEndedThisDial(
        { integrated: true, phase: 'ended', startedAt: DIAL_AT + 50 },
        DIAL_AT,
      ),
    ).toBe(true);
  });

  it('não encerra uma discagem nova por uma sessão que já tinha caído', () => {
    expect(
      integratedSessionEndedThisDial(
        { integrated: true, phase: 'ended', startedAt: DIAL_AT - 5_000 },
        DIAL_AT,
      ),
    ).toBe(false);
  });

  it('ignora sessão ainda em chamada, não integrada ou ausente', () => {
    expect(integratedSessionEndedThisDial({ integrated: true, phase: 'in-call', startedAt: DIAL_AT }, DIAL_AT)).toBe(false);
    expect(integratedSessionEndedThisDial({ integrated: false, phase: 'ended', startedAt: DIAL_AT }, DIAL_AT)).toBe(false);
    expect(integratedSessionEndedThisDial(null, DIAL_AT)).toBe(false);
    expect(integratedSessionEndedThisDial({ integrated: true, phase: 'ended', startedAt: DIAL_AT }, null)).toBe(false);
  });
});

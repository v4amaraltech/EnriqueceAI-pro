import { describe, expect, it } from 'vitest';

import { RAMAL_BUSY_MAX_TOTAL_MS, RAMAL_BUSY_RETRY_INTERVAL_MS, nextRamalBusyStep } from './ramal-busy-retry';

describe('nextRamalBusyStep (A-D11)', () => {
  it('o 1º 424 espera 5 s e fixa o início da sequência', () => {
    expect(nextRamalBusyStep({ firstBusyAt: null, now: 1000 })).toEqual({ action: 'wait', waitMs: 5000, firstBusyAt: 1000 });
  });
  it('repete a cada 5 s até 1 min', () => {
    expect(nextRamalBusyStep({ firstBusyAt: 1000, now: 1000 + 5000 })).toMatchObject({ action: 'wait', waitMs: RAMAL_BUSY_RETRY_INTERVAL_MS });
    expect(nextRamalBusyStep({ firstBusyAt: 1000, now: 1000 + 59_999 })).toMatchObject({ action: 'wait' });
  });
  it('com 60 s ou mais de 424 seguidos, pausa', () => {
    expect(nextRamalBusyStep({ firstBusyAt: 1000, now: 1000 + RAMAL_BUSY_MAX_TOTAL_MS })).toEqual({ action: 'pause', firstBusyAt: 1000 });
    expect(nextRamalBusyStep({ firstBusyAt: 1000, now: 1000 + 90_000 })).toMatchObject({ action: 'pause' });
  });
});

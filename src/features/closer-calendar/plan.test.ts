import { describe, expect, it } from 'vitest';

import { calendarReadPlan } from './plan';

describe('de qual agenda ler o horário', () => {
  it('com a conexão própria do closer, não usa o Google do SDR', () => {
    expect(calendarReadPlan({
      ownConnected: true,
      closerUserId: null,
      closerHasPlatformConnection: false,
      sdrHasConnection: true,
    })).toBe('own');
  });

  it('sem a conexão própria, mantém o plano atual: usuário da plataforma e depois o SDR', () => {
    expect(calendarReadPlan({
      ownConnected: false,
      closerUserId: 'user-1',
      closerHasPlatformConnection: true,
      sdrHasConnection: true,
    })).toBe('platform');
    expect(calendarReadPlan({
      ownConnected: false,
      closerUserId: null,
      closerHasPlatformConnection: false,
      sdrHasConnection: true,
    })).toBe('sdr');
  });

  it('sem conexão dos dois lados não marca horário livre', () => {
    expect(calendarReadPlan({
      ownConnected: false,
      closerUserId: null,
      closerHasPlatformConnection: false,
      sdrHasConnection: false,
    })).toBe('none');
  });
});

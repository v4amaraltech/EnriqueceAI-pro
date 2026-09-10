import { describe, expect, it } from 'vitest';

import { resolveMeetingHeldAt } from './meeting-held-at';

describe('resolveMeetingHeldAt', () => {
  // O caso que motivou a função: reunião dia 9 às 16h, ganho dia 10 às 9h.
  it('herda a data da reunião quando o ganho é dado depois', () => {
    const evento = '2026-09-09T19:00:00.000Z'; // 16:00 BRT do dia 9
    const cliqueNoDiaSeguinte = new Date('2026-09-10T12:00:00.000Z'); // 09:00 BRT do dia 10

    expect(resolveMeetingHeldAt(evento, cliqueNoDiaSeguinte)).toBe(evento);
  });

  it('não deixa a reunião escorregar para o mês seguinte', () => {
    const evento = '2026-08-31T21:00:00.000Z'; // 31/08 18:00 BRT
    const clique = new Date('2026-09-01T00:02:47.000Z'); // 01/09 21:02 BRT

    const held = new Date(resolveMeetingHeldAt(evento, clique));
    expect(held.toISOString()).toBe(evento);
    // Mês do evento (BRT) preservado — é o que o painel conta.
    expect(held.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })).toBe('2026-08-31');
  });

  it('usa o instante do clique quando o lead não tem reunião marcada', () => {
    const agora = new Date('2026-09-10T12:00:00.000Z');

    expect(resolveMeetingHeldAt(null, agora)).toBe(agora.toISOString());
    expect(resolveMeetingHeldAt(undefined, agora)).toBe(agora.toISOString());
  });

  it('usa o instante do clique quando a data do evento é inválida', () => {
    const agora = new Date('2026-09-10T12:00:00.000Z');

    expect(resolveMeetingHeldAt('não é data', agora)).toBe(agora.toISOString());
  });

  it('não herda data futura — ganho antes da hora do evento fica no clique', () => {
    const eventoFuturo = '2026-10-05T14:00:00.000Z';
    const agora = new Date('2026-09-10T12:00:00.000Z');

    expect(resolveMeetingHeldAt(eventoFuturo, agora)).toBe(agora.toISOString());
  });
});

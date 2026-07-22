import { describe, expect, it } from 'vitest';

import { DISPOSITION_OPTIONS, mapDispositionToAction } from './disposition';

describe('mapDispositionToAction', () => {
  it('advances on a real conversation', () => {
    expect(mapDispositionToAction('significant')).toBe('advance');
    expect(mapDispositionToAction('not_significant')).toBe('advance');
  });

  it('reschedules only when the lead asked for a callback', () => {
    // `busy` = o lead ATENDEU e pediu para ligar depois — há horário combinado.
    expect(mapDispositionToAction('busy')).toBe('reschedule');
  });

  it('advances on no answer — a cadência cuida da retentativa', () => {
    // Regressão: reagendar aqui obrigava o SDR a escolher uma data no caso mais
    // comum do dia. Ninguém falou com ninguém, então não há retorno combinado.
    expect(mapDispositionToAction('no_contact')).toBe('advance');
  });

  it('does nothing on a technical failure', () => {
    expect(mapDispositionToAction('not_connected')).toBe('none');
  });

  it('exposes all five dispositions as options', () => {
    expect(DISPOSITION_OPTIONS).toHaveLength(5);
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).toEqual([
      'significant',
      'not_significant',
      'busy',
      'no_contact',
      'not_connected',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { DISPOSITION_OPTIONS, mapDispositionToAction } from './disposition';

describe('mapDispositionToAction', () => {
  it('advances on a real conversation', () => {
    expect(mapDispositionToAction('significant')).toBe('advance');
    expect(mapDispositionToAction('not_significant')).toBe('advance');
  });

  it('reschedules on busy / no answer', () => {
    expect(mapDispositionToAction('busy')).toBe('reschedule');
    expect(mapDispositionToAction('no_contact')).toBe('reschedule');
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

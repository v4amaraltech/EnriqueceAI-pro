import { describe, expect, it } from 'vitest';

import { buildSdrOptions } from './resolve-cockpit-viewer';

const names: Record<string, string> = { mgr: 'Vini', 'sdr-a': 'Zélia', 'sdr-b': 'Ana' };
const nameOf = (id: string) => names[id] ?? id;

describe('buildSdrOptions', () => {
  it('gestor: ele mesmo no topo ("(você)") e SDRs em ordem alfabética', () => {
    expect(buildSdrOptions({ isManager: true, viewerId: 'mgr', sdrIds: ['sdr-a', 'sdr-b'], nameOf })).toEqual([
      { userId: 'mgr', name: 'Vini (você)' },
      { userId: 'sdr-b', name: 'Ana' },
      { userId: 'sdr-a', name: 'Zélia' },
    ]);
  });

  it('viewer dentro de sdrIds: não duplica a opção do gestor', () => {
    const out = buildSdrOptions({ isManager: true, viewerId: 'mgr', sdrIds: ['mgr', 'sdr-b'], nameOf });
    expect(out.map((o) => o.userId)).toEqual(['mgr', 'sdr-b']);
    expect(out[0]?.name).toBe('Vini (você)');
  });

  it('gestor em org sem SDR: sem opções (como antes)', () => {
    expect(buildSdrOptions({ isManager: true, viewerId: 'mgr', sdrIds: [], nameOf })).toEqual([]);
  });

  it('SDR nunca ganha a opção "(você)"', () => {
    const out = buildSdrOptions({ isManager: false, viewerId: 'sdr-a', sdrIds: [], nameOf });
    expect(out).toEqual([]);
  });
});

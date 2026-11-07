import { describe, expect, it } from 'vitest';

import { parseCockpitTab, pickCockpitTarget } from './cockpit-target';

const sdrIds = ['sdr-a', 'sdr-b'];

describe('pickCockpitTarget', () => {
  it('SDR sempre vê os próprios dados, mesmo pedindo outro', () => {
    expect(pickCockpitTarget({ isManager: false, viewerId: 'sdr-a', requested: 'sdr-b', sdrIds })).toBe('sdr-a');
  });

  it('gestor vê o SDR pedido', () => {
    expect(pickCockpitTarget({ isManager: true, viewerId: 'mgr', requested: 'sdr-b', sdrIds })).toBe('sdr-b');
  });

  it('gestor pedindo alguém fora da lista cai no primeiro SDR', () => {
    expect(pickCockpitTarget({ isManager: true, viewerId: 'mgr', requested: 'intruso', sdrIds })).toBe('sdr-a');
    expect(pickCockpitTarget({ isManager: true, viewerId: 'mgr', requested: null, sdrIds })).toBe('sdr-a');
  });

  it('gestor sem SDR na org vê a si mesmo', () => {
    expect(pickCockpitTarget({ isManager: true, viewerId: 'mgr', requested: null, sdrIds: [] })).toBe('mgr');
  });
});

describe('parseCockpitTab', () => {
  it('aceita abas válidas e cai em tarefas no resto', () => {
    expect(parseCockpitTab('closers')).toBe('closers');
    expect(parseCockpitTab('xyz')).toBe('tarefas');
    expect(parseCockpitTab(undefined)).toBe('tarefas');
  });
});
